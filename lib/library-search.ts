import config from "@/lib/config"
import { parseSearchInput, fuseSearchResults, type SearchResultItem } from "@/lib/global-search"
import { searchDocumentChunks, findMatchingDocuments, searchDocumentsByContent } from "@/lib/retrieval"
import { documentIdsInStage, listWorkspaceDocuments, type LibraryListFilters } from "@/models/documents"

export type LibraryScope = "smart" | "content" | "filename" | "supplier" | "category"

export type LibrarySearchOutcome =
  | { kind: "ranked"; orderedIds: string[]; snippets: Map<string, { text: string; page: number | null }>; degraded: boolean }
  | { kind: "filter"; filters: Partial<LibraryListFilters> }

const VALID_SCOPES: ReadonlySet<string> = new Set<LibraryScope>(["smart", "content", "filename", "supplier", "category"])

export function isValidScope(value: string | undefined): value is LibraryScope {
  return value != null && VALID_SCOPES.has(value)
}

export async function runGlobalSearch(workspaceId: string, query: string, actorId: string): Promise<{ items: SearchResultItem[]; total: number }> {
  if (!query.trim()) return { items: [], total: 0 }

  const parsed = parseSearchInput(query)

  const [chunkResults, fieldResult, contentResults] = await Promise.all([
    parsed.text
      ? searchDocumentChunks(workspaceId, parsed.text, {
          limit: 20,
          filters: parsed.filters.length ? parsed.filters : undefined,
          actorId,
        })
      : Promise.resolve([]),
    parsed.filters.length || parsed.text
      ? findMatchingDocuments(workspaceId, parsed.text || query, { actorId })
      : Promise.resolve(null),
    parsed.text
      ? searchDocumentsByContent(workspaceId, parsed.text, { limit: 20, actorId })
      : Promise.resolve([]),
  ])

  const fieldMatches = fieldResult?.kind === "matches"
    ? fieldResult.documents.map((d) => ({ documentId: d.documentId, filename: d.filename, values: d.values }))
    : []
  const chunkMapped = chunkResults.map((c) => ({ documentId: c.documentId, filename: c.filename, page: c.page, bbox: c.bbox, snippet: c.snippet, score: c.score }))
  const contentMapped = contentResults.map((c) => ({ documentId: c.documentId, filename: c.filename, page: c.page, bbox: c.bbox, snippet: c.snippet }))

  const items = fuseSearchResults(fieldMatches, chunkMapped, contentMapped)
  return { items, total: items.length }
}

export async function runLibrarySearch(workspaceId: string, q: string, scope: LibraryScope, actorId: string): Promise<LibrarySearchOutcome> {
  if (!q.trim()) return { kind: "filter", filters: {} }

  switch (scope) {
    case "filename":
      return { kind: "filter", filters: { filenameQuery: q } }

    case "supplier":
      return { kind: "filter", filters: { supplier: q } }

    case "category":
      return { kind: "filter", filters: { category: q } }

    case "content": {
      if (!config.embeddings.enabled) {
        return { kind: "filter", filters: { filenameQuery: q } }
      }
      const contentHits = await searchDocumentsByContent(workspaceId, q, { limit: 50, actorId })
      const snippetMap = new Map<string, { text: string; page: number | null }>()
      const ids: string[] = []
      for (const hit of contentHits) {
        if (!snippetMap.has(hit.documentId)) {
          snippetMap.set(hit.documentId, { text: hit.snippet, page: hit.page })
          ids.push(hit.documentId)
        }
      }
      const readyIds = await documentIdsInStage(workspaceId, ids, "ready")
      const filteredIds = ids.filter((id) => readyIds.has(id))
      return { kind: "ranked", orderedIds: filteredIds, snippets: snippetMap, degraded: false }
    }

    case "smart": {
      const degraded = !config.embeddings.enabled
      const { items } = await runGlobalSearch(workspaceId, q, actorId)

      const docItems = items.filter((item) => item.type === "document")
      const allIds = docItems.map((item) => item.documentId)

      if (degraded && !allIds.length) {
        const fallback = await listWorkspaceDocuments(workspaceId, { stage: "ready", query: q })
        const snippetMap = new Map<string, { text: string; page: number | null }>()
        return { kind: "ranked", orderedIds: fallback.map((d) => d.id), snippets: snippetMap, degraded: true }
      }

      const readyIds = await documentIdsInStage(workspaceId, allIds, "ready")
      const filteredIds = allIds.filter((id) => readyIds.has(id))

      const snippetMap = new Map<string, { text: string; page: number | null }>()
      for (const item of items) {
        if (item.type === "snippet" && item.snippet && !snippetMap.has(item.documentId)) {
          snippetMap.set(item.documentId, { text: item.snippet, page: item.page ?? null })
        }
      }

      return { kind: "ranked", orderedIds: filteredIds, snippets: snippetMap, degraded }
    }
  }
}
