import { getCurrentUser } from "@/lib/auth"
import { requireWorkspaceRole } from "@/models/workspaces"
import { redirect } from "next/navigation"
import { SearchPageClient } from "./search-client"

export default async function SearchPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ q?: string; ask?: string }>
}) {
  const user = await getCurrentUser()
  const { workspaceId } = await params
  await requireWorkspaceRole(workspaceId, user.id)
  const { q, ask } = await searchParams

  if (!q?.trim()) redirect(`/workspaces/${workspaceId}`)

  return <SearchPageClient workspaceId={workspaceId} initialQuery={q} askMode={ask === "1"} />
}
