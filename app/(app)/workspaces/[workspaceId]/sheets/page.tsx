import { redirect } from "next/navigation"

export default async function SheetsRedirectPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  redirect(`/workspaces/${workspaceId}/files`)
}
