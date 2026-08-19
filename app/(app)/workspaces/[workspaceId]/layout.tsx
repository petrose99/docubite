import { Sidebar } from "@/components/shell/sidebar"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { getWorkspaceMembership, getWorkspacesForUser } from "@/models/workspaces"
import { redirect } from "next/navigation"

/** App shell: Lido's persistent left rail, full-bleed content beside it. The Files list and the
 * sheet both fill the remaining viewport; pages that want the narrower reading column wrap
 * themselves via the (chrome) route group's layout. */
export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  // A layout throw would escape the segment's own error boundary and hit the global error
  // page, so send non-members to their workspace list instead.
  const membership = await getWorkspaceMembership(workspaceId, user.id)
  if (!membership) redirect("/workspaces")
  const workspaces = await getWorkspacesForUser(user.id)

  return <div className="flex min-h-screen bg-white text-stone-900">
    <Sidebar
      workspaceId={workspaceId}
      workspaces={workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, kind: workspace.kind, role: workspace.members[0]?.role }))}
      user={{ name: user.name, email: user.email }}
      dictationEnabled={config.asr.enabled} />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
  </div>
}
