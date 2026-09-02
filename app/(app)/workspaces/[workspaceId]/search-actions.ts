"use server"

import { getCurrentUser } from "@/lib/auth"
import { parseSearchInput, fuseSearchResults, type SearchResultItem } from "@/lib/global-search"
import { searchDocumentChunks, findMatchingDocuments, searchDocumentsByContent } from "@/lib/retrieval"
import { requireWorkspaceRole } from "@/models/workspaces"

export type GlobalSearchResult = {
  items: SearchResultItem[]
  total: number
}

export async function globalSearchAction(
  workspaceId: string,
  query: string,
): Promise<GlobalSearchResult> {
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)

  if (!query.trim()) return { items: [], total: 0 }

  const parsed = parseSearchInput(query)

  const [chunkResults, fieldResult, contentResults] = await Promise.all([
    parsed.text
      ? searchDocumentChunks(workspaceId, parsed.text, {
          limit: 20,
          filters: parsed.filters.length ? parsed.filters : undefined,
          actorId: user.id,
        })
      : Promise.resolve([]),

    parsed.filters.length || parsed.text
      ? findMatchingDocuments(workspaceId, parsed.text || query, { actorId: user.id })
      : Promise.resolve(null),

    parsed.text
      ? searchDocumentsByContent(workspaceId, parsed.text, { limit: 20, actorId: user.id })
      : Promise.resolve([]),
  ])

  const fieldMatches = fieldResult?.kind === "matches"
    ? fieldResult.documents.map((d) => ({
        documentId: d.documentId,
        filename: d.filename,
        values: d.values,
      }))
    : []

  const chunkMapped = chunkResults.map((c) => ({
    documentId: c.documentId,
    filename: c.filename,
    page: c.page,
    bbox: c.bbox,
    snippet: c.snippet,
    score: c.score,
  }))

  const contentMapped = contentResults.map((c) => ({
    documentId: c.documentId,
    filename: c.filename,
    page: c.page,
    bbox: c.bbox,
    snippet: c.snippet,
  }))

  const items = fuseSearchResults(fieldMatches, chunkMapped, contentMapped)

  return { items: items.slice(0, 30), total: items.length }
}
