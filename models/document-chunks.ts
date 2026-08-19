import type { ChunkProvenance } from "@/lib/chunking"
import { prisma } from "@/lib/db"
import { toVectorLiteral } from "@/lib/embeddings"
import { compileFieldFilters, type FieldFilter } from "@/models/document-field-values"

/** The chunk store is the only hand-written SQL in the codebase, because pgvector's operators and
 * a generated tsvector column cannot be expressed through Prisma. Every statement is built by a
 * pure function (below) that returns its text and ordered bind params, so the SQL can be asserted
 * in a unit test without a database. workspace_id is a bind param in EVERY statement — retrieval
 * and deletion are always scoped to one workspace, never widened by a caller. */

/** A built statement: parameterised SQL and its ordered bind values, run via $queryRawUnsafe. */
export type Sql = { text: string; params: unknown[] }

/** One row as it goes into an INSERT: provenance already stringified (or null), embedding already
 * formatted as a pgvector literal. */
type InsertRow = {
  workspaceId: string
  documentId: string
  fileId: string
  chunkIndex: number
  text: string
  provenance: string | null
  contentHash: string
  embedding: string
  source: string
}

/** A hydrated search hit. document_id/chunk_index are aliased to camelCase in SQL so the driver
 * returns them ready to use; provenance comes back as parsed JSON. */
export type ChunkSearchRow = {
  id: string
  documentId: string
  fileId: string
  chunkIndex: number
  text: string
  provenance: ChunkProvenance | null
  score: number
  /** vlm_ocr | asr | llm_structured | manual — how this text was obtained. */
  source: string
}

/** Rows per INSERT statement. Batched so a 512-chunk document is a handful of statements rather
 * than one enormous one, while still being far fewer round trips than a row apiece. */
const INSERT_BATCH = 50

// ---- Pure SQL builders (tested directly) -----------------------------------------------------

export function buildDeleteChunksSql(workspaceId: string, documentId: string): Sql {
  return {
    text: `DELETE FROM "document_chunks" WHERE "document_id" = $1::uuid AND "workspace_id" = $2::uuid`,
    params: [documentId, workspaceId],
  }
}

export function buildHashesSql(workspaceId: string, documentId: string): Sql {
  return {
    text: `SELECT "content_hash" AS "contentHash" FROM "document_chunks" WHERE "document_id" = $1::uuid AND "workspace_id" = $2::uuid ORDER BY "chunk_index"`,
    params: [documentId, workspaceId],
  }
}

/** Multi-row INSERT with per-value casts. Every value is a bind — no data is ever interpolated
 * into the SQL text — and workspace_id is bound once per row. */
export function buildInsertChunksSql(rows: InsertRow[]): Sql {
  const params: unknown[] = []
  const bind = (value: unknown) => {
    params.push(value)
    return `$${params.length}`
  }
  const tuples = rows.map((row) =>
    `(${bind(row.workspaceId)}::uuid, ${bind(row.documentId)}::uuid, ${bind(row.fileId)}::uuid, ${bind(row.chunkIndex)}, ${bind(row.text)}, ${bind(row.provenance)}::jsonb, ${bind(row.contentHash)}, ${bind(row.embedding)}::vector, ${bind(row.source)})`
  )
  return {
    text: `INSERT INTO "document_chunks" ("workspace_id", "document_id", "file_id", "chunk_index", "text", "provenance", "content_hash", "embedding", "source") VALUES ${tuples.join(", ")}`,
    params,
  }
}

/** Compiles optional structured pre-filters into extra WHERE clauses for a search channel.
 *
 * PRE-filters, not post-filters: the clause sits in the same WHERE as the workspace scope, so a
 * highly selective filter (an invoice number, a patient id) narrows the set the index walks instead
 * of discarding neighbours after they were already ranked. With no filters this appends nothing and
 * both queries are byte-for-byte what they were before.
 *
 * `bind` continues the caller's parameter list, so filter binds land after the channel's own. */
function filterClauses(filters: FieldFilter[], workspaceRef: string, bind: (value: unknown) => string): string {
  const predicates = compileFieldFilters(filters, `"document_chunks"."document_id"`, workspaceRef, bind)
  return predicates.length ? ` AND ${predicates.join(" AND ")}` : ""
}

/** Vector half of hybrid retrieval: nearest neighbours by cosine distance, workspace-scoped, with
 * the score expressed as cosine similarity (1 - distance). */
export function buildVectorSearchSql(workspaceId: string, vectorLiteral: string, limit: number, filters: FieldFilter[] = []): Sql {
  // The first three binds keep their positions ($1 vector, $2 workspace, $3 limit) so an unfiltered
  // call is unchanged; filter binds are appended from $4.
  const params: unknown[] = [vectorLiteral, workspaceId, limit]
  const bind = (value: unknown) => {
    params.push(value)
    return `$${params.length}`
  }
  return {
    text: `SELECT "id", "document_id" AS "documentId", "file_id" AS "fileId", "chunk_index" AS "chunkIndex", "text", "provenance", "source",1 - ("embedding" <=> $1::vector) AS "score"
       FROM "document_chunks"
       WHERE "workspace_id" = $2::uuid AND "embedding" IS NOT NULL${filterClauses(filters, `$2::uuid`, bind)}
       ORDER BY "embedding" <=> $1::vector
       LIMIT $3`,
    params,
  }
}

/** Lexical half: full-text match with the 'simple' config so identifiers match verbatim.
 * websearch_to_tsquery never throws on user input, so a query full of punctuation degrades to a
 * bag of words rather than erroring the search. */
export function buildLexicalSearchSql(workspaceId: string, query: string, limit: number, filters: FieldFilter[] = []): Sql {
  const params: unknown[] = [query, workspaceId, limit]
  const bind = (value: unknown) => {
    params.push(value)
    return `$${params.length}`
  }
  return {
    text: `SELECT "id", "document_id" AS "documentId", "file_id" AS "fileId", "chunk_index" AS "chunkIndex", "text", "provenance", "source",ts_rank_cd("text_tsv", websearch_to_tsquery('simple', $1)) AS "score"
       FROM "document_chunks"
       WHERE "workspace_id" = $2::uuid AND "text_tsv" @@ websearch_to_tsquery('simple', $1)${filterClauses(filters, `$2::uuid`, bind)}
       ORDER BY "score" DESC
       LIMIT $3`,
    params,
  }
}

// ---- Execution --------------------------------------------------------------------------------

/** One chunk ready to store: its embedding vector plus the chunk's text, provenance and hash. */
export type ChunkInsert = {
  chunkIndex: number
  text: string
  provenance: ChunkProvenance | null
  contentHash: string
  embedding: number[]
}

/** Replaces a document's chunks atomically: delete the old set, insert the new one in batches, in
 * a single transaction so a reader never sees the document half-indexed. Idempotent — running it
 * again with the same chunks produces the same rows. */
export async function replaceDocumentChunks(params: { workspaceId: string; documentId: string; fileId: string; chunks: ChunkInsert[]; source?: string }): Promise<void> {
  const { workspaceId, documentId, fileId, chunks } = params
  const rows: InsertRow[] = chunks.map((chunk) => ({
    workspaceId,
    documentId,
    fileId,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
    provenance: chunk.provenance ? JSON.stringify(chunk.provenance) : null,
    contentHash: chunk.contentHash,
    embedding: toVectorLiteral(chunk.embedding),
    // Defaults to OCR because that is where all but dictated documents come from; the embed job
    // passes "asr" for a dictation.
    source: params.source ?? "vlm_ocr",
  }))
  const del = buildDeleteChunksSql(workspaceId, documentId)
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(del.text, ...del.params)
    for (let start = 0; start < rows.length; start += INSERT_BATCH) {
      const ins = buildInsertChunksSql(rows.slice(start, start + INSERT_BATCH))
      await tx.$executeRawUnsafe(ins.text, ...ins.params)
    }
  })
}

/** The content hashes of a document's stored chunks, in chunk order, so a re-embed can compare
 * against the freshly computed set and skip the endpoint entirely when nothing changed. */
export async function getDocumentChunkHashes(workspaceId: string, documentId: string): Promise<string[]> {
  const built = buildHashesSql(workspaceId, documentId)
  const rows = await prisma.$queryRawUnsafe<{ contentHash: string }[]>(built.text, ...built.params)
  return rows.map((row) => row.contentHash)
}

/** Deletes a document's chunks (used when a re-embed finds the document is now empty). */
export async function deleteDocumentChunks(workspaceId: string, documentId: string): Promise<void> {
  const built = buildDeleteChunksSql(workspaceId, documentId)
  await prisma.$executeRawUnsafe(built.text, ...built.params)
}

/** Vector nearest-neighbour search. Runs inside a transaction so the two SET LOCALs apply to just
 * this query: iterative scan is what keeps recall up when the HNSW index is filtered by workspace,
 * and a wider ef_search trades a little latency for better recall. */
export async function vectorSearch(workspaceId: string, vec: number[], limit: number, filters: FieldFilter[] = []): Promise<ChunkSearchRow[]> {
  const built = buildVectorSearchSql(workspaceId, toVectorLiteral(vec), limit, filters)
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = 80`)
    await tx.$executeRawUnsafe(`SET LOCAL hnsw.iterative_scan = 'relaxed_order'`)
    return tx.$queryRawUnsafe<ChunkSearchRow[]>(built.text, ...built.params)
  })
}

/** Lexical full-text search — the other half of hybrid retrieval, catching exact identifiers a
 * semantic search can miss. */
export async function lexicalSearch(workspaceId: string, query: string, limit: number, filters: FieldFilter[] = []): Promise<ChunkSearchRow[]> {
  const built = buildLexicalSearchSql(workspaceId, query, limit, filters)
  return prisma.$queryRawUnsafe<ChunkSearchRow[]>(built.text, ...built.params)
}
