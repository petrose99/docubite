"use server"

import { getCurrentUser } from "@/lib/auth"
import type { SearchResultItem } from "@/lib/global-search"
import { runGlobalSearch } from "@/lib/library-search"
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

  const { items, total } = await runGlobalSearch(workspaceId, query, user.id)
  return { items: items.slice(0, 30), total }
}
