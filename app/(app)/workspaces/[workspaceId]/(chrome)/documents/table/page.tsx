import { redirect } from "next/navigation"

// The review table grew into the full-screen extraction sheet, which now lives inside a file.
// Old links no longer name a file, so land on the Files list.
export default async function LegacyTablePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  redirect(`/workspaces/${workspaceId}/files`)
}
