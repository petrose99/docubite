import { getCurrentUser } from "@/lib/auth"
import { requireWorkspaceRole } from "@/models/workspaces"

/** Narrow reading column for the document detail and settings pages. Navigation lives in the
 * app shell's sidebar one level up; the Files list and the sheet fill the viewport instead. */
export default async function WorkspaceChromeLayout({ children, params }: { children: React.ReactNode; params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)
  return <div className="mx-auto w-full max-w-4xl p-6">{children}</div>
}
