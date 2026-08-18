import type { ChunkProvenance } from "@/lib/chunking"
import config from "@/lib/config"
import { prisma } from "@/lib/db"
import { embedTexts } from "@/lib/embeddings"
import { lexicalSearch, vectorSearch, type ChunkSearchRow } from "@/models/document-chunks"

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

/** Hybrid document search over one workspace's chunks. The lexical half always runs; the vector
 * half runs only if the query can be embedded — if the embedding endpoint is down at query time
 * the search degrades to lexical-only rather than failing the whole answer. Results are fused with
 * RRF, trimmed to `limit`, and hydrated with filenames in a single workspace-scoped query. */
export async function searchDocumentChunks(workspaceId: string, query: string, options: { limit?: number } = {}): Promise<DocumentSearchResult[]> {
  const limit = options.limit ?? DEFAULT_LIMIT

  // Run lexical in parallel with (embed → vector) so the vector path's extra round trip does not
  // add latency on top of the lexical search.
  const lexicalPromise = lexicalSearch(workspaceId, query, RETRIEVE_PER_HALF)
  const vectorPromise: Promise<ChunkSearchRow[]> = (async () => {
    try {
      const [queryVec] = await embedTexts([query], "query")
      return queryVec ? await vectorSearch(workspaceId, queryVec, RETRIEVE_PER_HALF) : []
    } catch (error) {
      console.error("document search: embedding unavailable, using lexical only:", error instanceof Error ? error.message : error)
      return []
    }
  })()
  const [lexicalHits, vectorHits] = await Promise.all([lexicalPromise, vectorPromise])

  const fused = rrfFuse([vectorHits, lexicalHits]).slice(0, limit)
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
      }
    })
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
