import type { ChunkProvenance } from "@/lib/chunking"
import config from "@/lib/config"
import { prisma } from "@/lib/db"
import { embedTexts } from "@/lib/embeddings"
import { routeQuery } from "@/lib/query-router"
import { rerank } from "@/lib/rerank"
import { lexicalSearch, vectorSearch, type ChunkSearchRow } from "@/models/document-chunks"
import { findDocumentsByFields, listWorkspaceFieldKeys, type FieldFilter } from "@/models/document-field-values"

/** How many candidates each half of the hybrid search returns before fusion, and how many chunks
 * the snippet is capped at. The default number of fused results the caller receives is 8. */
const RETRIEVE_PER_HALF = 24
const DEFAULT_LIMIT = 8
const SNIPPET_CHARS = 700

/** One retrieved chunk, ready to hand to the model: which document it is from, the page to cite, a
 * snippet, and its fused relevance score. `pages` is every page the chunk spans; `bbox` is the
 * chunk's union rectangle in 0-1 space, carried only when the chunk sits on a single page (a
 * multi-page union rectangle is meaningless on any one page, so it is nulled and the viewer falls
 * back to its "matched on page N, exact position unavailable" note). */
export type DocumentSearchResult = {
  documentId: string
  filename: string
  page: number | null
  pages: number[]
  bbox: [number, number, number, number] | null
  snippet: string
  score: number
  /** How this text was obtained: vlm_ocr | asr | llm_structured | manual. Carried into the model's
   * context so a citation can distinguish evidence read off a page from evidence heard in a
   * dictation — different error modes, different weight. */
  source: string
}

/** Records that a search happened. Retrieval returns document contents to whoever asked, which
 * makes it a disclosure event; without this, "who looked at what" is unanswerable.
 *
 * Best effort and never awaited into the critical path's failure modes: an audit write that fails
 * must not fail the search the user is waiting on. */
async function recordSearch(workspaceId: string, actorId?: string | null) {
  // try/catch, not .catch(): if prisma.documentAuditEvent were ever undefined the property access
  // throws SYNCHRONOUSLY, before any promise exists for .catch() to attach to — and an audit write
  // must not be able to break the search it is auditing, by any route.
  try {
    // The query text is deliberately NOT stored. It can contain the same sensitive content the
    // documents do, and an audit trail that accumulates verbatim clinical queries becomes a second
    // copy of the data it exists to protect. Who searched, in which workspace, and when is what
    // makes disclosure answerable; what they typed is not needed for that.
    await prisma.documentAuditEvent.create({
      data: { workspaceId, actorId: actorId ?? null, type: "document_searched", documentId: null },
    })
  } catch {
    /* auditing is best effort — never fail a search for it */
  }
}

/** Reciprocal Rank Fusion: combine several ranked lists into one, scoring each item by the sum of
 * 1/(k + rank) across the lists it appears in. Rank-based rather than score-based, so a cosine
 * similarity and a ts_rank — which are on entirely different scales — can be merged without
 * normalising either. Dedupes by id (keeping the first-seen object) and is a stable sort, so items
 * tied on score keep the order they were first encountered in. */
export function rrfFuse<T extends { id: string }>(lists: T[][], k = 60): (T & { score: number })[] {
  const scores = new Map<string, number>()
  const items = new Map<string, T>()
  const order: string[] = []
  for (const list of lists) {
    list.forEach((item, index) => {
      if (!items.has(item.id)) {
        items.set(item.id, item)
        order.push(item.id)
      }
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + index + 1))
    })
  }
  return order
    .map((id) => ({ ...(items.get(id) as T), score: scores.get(id) as number }))
    .sort((a, b) => b.score - a.score)
}

function firstPage(provenance: ChunkProvenance | null): number | null {
  return provenance?.pages?.length ? provenance.pages[0] : null
}

/** Round each coordinate to 4 decimals. This bbox rides along in JSON that enters the model's
 * context, and 0.1-space floats otherwise carry a dozen meaningless digits of token weight. */
function roundBbox(bbox: [number, number, number, number]): [number, number, number, number] {
  return bbox.map((n) => Math.round(n * 1e4) / 1e4) as [number, number, number, number]
}

/** How many fused candidates are handed to the reranker before the list is trimmed to `limit`.
 * Reranking is per-candidate work, so this caps the cost; it is a no-op while the reranker is the
 * identity function (the default). */
const RERANK_CANDIDATES = 24

/** Hybrid document search over one workspace's chunks. The lexical half always runs; the vector
 * half runs only if the query can be embedded — if the embedding endpoint is down at query time
 * the search degrades to lexical-only rather than failing the whole answer. Results are fused with
 * RRF, reranked (identity unless a reranker is configured), trimmed to `limit`, and hydrated with
 * filenames in a single workspace-scoped query.
 *
 * Two additions sit on top of that unchanged core, both off by default:
 * - `filters` are structured pre-filters applied INSIDE both channel queries, so a selective
 *   constraint narrows what the indexes walk rather than discarding already-ranked neighbours.
 * - `route`, when on, first asks the query router to split the query into filters plus a semantic
 *   remainder. Routing failures fall back to the raw query and no filters, so the routed path can
 *   never return less than the unrouted one would have. */
export async function searchDocumentChunks(
  workspaceId: string,
  query: string,
  options: { limit?: number; filters?: FieldFilter[]; route?: boolean; actorId?: string | null } = {},
): Promise<DocumentSearchResult[]> {
  const limit = options.limit ?? DEFAULT_LIMIT
  await recordSearch(workspaceId, options.actorId)

  // Caller-supplied filters always apply; routed ones are added to them. The router is only asked
  // when routing is on AND the caller did not already pin the query down itself.
  const routed = options.route && !options.filters?.length ? await routeQuery(workspaceId, query) : null
  const filters = [...(options.filters ?? []), ...(routed?.filters ?? [])]
  const searchText = routed?.semanticQuery || query

  // Run lexical in parallel with (embed → vector) so the vector path's extra round trip does not
  // add latency on top of the lexical search.
  const lexicalPromise = lexicalSearch(workspaceId, searchText, RETRIEVE_PER_HALF, filters)
  const vectorPromise: Promise<ChunkSearchRow[]> = (async () => {
    try {
      const [queryVec] = await embedTexts([searchText], "query")
      return queryVec ? await vectorSearch(workspaceId, queryVec, RETRIEVE_PER_HALF, filters) : []
    } catch (error) {
      console.error("document search: embedding unavailable, using lexical only:", error instanceof Error ? error.message : error)
      return []
    }
  })()
  const [lexicalHits, vectorHits] = await Promise.all([lexicalPromise, vectorPromise])

  const candidates = rrfFuse([vectorHits, lexicalHits]).slice(0, RERANK_CANDIDATES)
  // Reranked against the semantic remainder, not the raw query: the filtered-out part of the
  // question is already satisfied by every candidate and would only dilute the relevance signal.
  const fused = (await rerank(searchText, candidates)).slice(0, limit)
  if (!fused.length) return []

  const documentIds = [...new Set(fused.map((hit) => hit.documentId))]
  const documents = await prisma.document.findMany({ where: { workspaceId, id: { in: documentIds } }, select: { id: true, filename: true } })
  const filenames = new Map(documents.map((doc) => [doc.id, doc.filename]))

  // A hit whose document is not in this workspace's set (deleted mid-query, or somehow foreign) is
  // dropped rather than returned without a filename.
  return fused
    .filter((hit) => filenames.has(hit.documentId))
    .map((hit) => {
      const pages = hit.provenance?.pages ?? []
      // A chunk's bbox is the union of its blocks; it only lands on one page when the chunk itself
      // spans exactly one, so it is passed through only then and nulled otherwise.
      const bbox = pages.length === 1 && hit.provenance?.bbox ? roundBbox(hit.provenance.bbox) : null
      return {
        documentId: hit.documentId,
        filename: filenames.get(hit.documentId) as string,
        page: firstPage(hit.provenance),
        pages,
        bbox,
        snippet: hit.text.slice(0, SNIPPET_CHARS),
        score: hit.score,
        source: hit.source ?? "vlm_ocr",
      }
    })
}

/** One document matched by structured filters, with the values that satisfied them. */
export type DocumentMatch = {
  documentId: string
  filename: string
  values: Record<string, unknown>
}

/** The result of a completeness query: either the full matching set, or an explanation of why no
 * filter could be derived — never a silent empty list, and never the whole workspace by accident. */
export type CompletenessResult =
  | { kind: "matches"; filters: FieldFilter[]; total: number; truncated: boolean; documents: DocumentMatch[] }
  | { kind: "no_filters"; availableFields: string[] }

/** How many matched documents are summarised back to the model. `total` is always the true count,
 * so "you have 240 invoices from this vendor" stays accurate even though only the first slice is
 * described — the number is the answer, the list is the evidence. */
const MATCH_SAMPLE = 50

/** The completeness channel: every document whose extracted values satisfy the query, not the
 * best-matching few.
 *
 * This is the question hybrid retrieval structurally cannot answer. "All invoices from Acme" over
 * chunks returns the 8 chunks that look most like the question; if Acme has 40 invoices, the answer
 * is wrong in a way that reads as confident. Here the filters run against the projected values, so
 * the count is a count.
 *
 * Returns `no_filters` rather than guessing when the query has no exactly checkable part — with no
 * filters this query matches the entire workspace, which is never a useful answer to a question. */
export async function findMatchingDocuments(workspaceId: string, query: string, options: { now?: Date } = {}): Promise<CompletenessResult> {
  const routed = await routeQuery(workspaceId, query, { now: options.now, force: true })
  if (!routed.filters.length) {
    const keys = await listWorkspaceFieldKeys(workspaceId).catch(() => [])
    return { kind: "no_filters", availableFields: keys.map((key) => (key.itemKey ? `${key.fieldKey}.${key.itemKey}` : key.fieldKey)) }
  }
  const { rows, truncated } = await findDocumentsByFields(workspaceId, routed.filters)
  return {
    kind: "matches",
    filters: routed.filters,
    total: rows.length,
    truncated,
    documents: rows.slice(0, MATCH_SAMPLE).map((row) => ({ documentId: row.documentId, filename: row.filename, values: row.reviewedData ?? {} })),
  }
}

/** How many characters of the matching chunk the Files content search shows under each hit. Much
 * shorter than the assistant's snippet — this is a search-result preview, not evidence to reason
 * over. */
const CONTENT_SNIPPET_CHARS = 140

/** One document-level content match for the Files search: the document, the file (sheet) it lives
 * in, that file's folder, and the best-matching passage with a page and highlight to open at. */
export type ContentSearchResult = {
  documentId: string
  filename: string
  fileId: string
  fileName: string
  folderId: string | null
  page: number | null
  bbox: [number, number, number, number] | null
  snippet: string
}

/** Content-aware Files search: the same hybrid recipe as the assistant's tool (embed the query,
 * run vector and lexical halves in parallel, fuse with RRF, degrade to lexical-only if the
 * embedding endpoint is down), but collapsed to one hit per *document* — the Files list is a list
 * of documents, not passages. Empty when the query is blank or document search is off. */
export async function searchDocumentsByContent(workspaceId: string, query: string, options: { limit?: number } = {}): Promise<ContentSearchResult[]> {
  if (!config.embeddings.enabled || !query.trim()) return []
  const limit = options.limit ?? DEFAULT_LIMIT

  const lexicalPromise = lexicalSearch(workspaceId, query, RETRIEVE_PER_HALF)
  const vectorPromise: Promise<ChunkSearchRow[]> = (async () => {
    try {
      const [queryVec] = await embedTexts([query], "query")
      return queryVec ? await vectorSearch(workspaceId, queryVec, RETRIEVE_PER_HALF) : []
    } catch (error) {
      console.error("content search: embedding unavailable, using lexical only:", error instanceof Error ? error.message : error)
      return []
    }
  })()
  const [lexicalHits, vectorHits] = await Promise.all([lexicalPromise, vectorPromise])

  const fused = rrfFuse([vectorHits, lexicalHits])
  if (!fused.length) return []

  // Keep the best-ranked chunk per document (fused is sorted best-first), then take the top docs.
  const bestByDoc = new Map<string, (typeof fused)[number]>()
  for (const hit of fused) if (!bestByDoc.has(hit.documentId)) bestByDoc.set(hit.documentId, hit)
  const top = [...bestByDoc.values()].slice(0, limit)

  const documents = await prisma.document.findMany({
    where: { workspaceId, id: { in: top.map((hit) => hit.documentId) } },
    select: { id: true, filename: true, fileId: true, file: { select: { name: true, folderId: true } } },
  })
  const byId = new Map(documents.map((doc) => [doc.id, doc]))

  return top
    .filter((hit) => byId.has(hit.documentId))
    .map((hit) => {
      const doc = byId.get(hit.documentId)!
      const pages = hit.provenance?.pages ?? []
      const bbox = pages.length === 1 && hit.provenance?.bbox ? roundBbox(hit.provenance.bbox) : null
      return {
        documentId: hit.documentId,
        filename: doc.filename,
        fileId: doc.fileId,
        fileName: doc.file?.name ?? "",
        folderId: doc.file?.folderId ?? null,
        page: firstPage(hit.provenance),
        bbox,
        snippet: hit.text.slice(0, CONTENT_SNIPPET_CHARS),
      }
    })
}
