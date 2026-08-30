import { Sidebar } from "@/components/shell/sidebar"
import { getCurrentUser, getSession } from "@/lib/auth"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { createClient } from "@/lib/supabase/server"
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

  // F15/F1: a hipaaMode workspace requires an aal2 session — MFA actually completed, not just
  // available. login-form.tsx already routes a fresh sign-in through /mfa/challenge when a factor
  // exists, so reaching here at aal1 despite one existing means an older session predates that
  // enrollment; step them up now rather than waiting for their next full login. If no verified
  // factor exists at all there is nothing to challenge — that's a real enforcement gap (the
  // workspace owner turned hipaaMode on before every member enrolled MFA), left as a nudge rather
  // than a dead-end redirect loop into a page they cannot complete.
  if (membership.workspace.hipaaMode) {
    const session = await getSession()
    if (session && session.aal !== "aal2") {
      const supabase = await createClient()
      const { data: factors } = await supabase.auth.mfa.listFactors()
      if (factors?.totp?.some((factor) => factor.status === "verified")) {
        redirect(`/mfa/challenge?next=${encodeURIComponent(`/workspaces/${workspaceId}`)}`)
      }
    }
  }

  const [workspaces, capabilities] = await Promise.all([
    getWorkspacesForUser(user.id),
    getWorkspaceCapabilities(workspaceId),
  ])

  return <div className="flex min-h-screen bg-white text-stone-900">
    <Sidebar
      workspaceId={workspaceId}
      workspaces={workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, kind: workspace.kind, role: workspace.members[0]?.role }))}
      user={{ name: user.name, email: user.email }}
      enabledModuleKeys={[...capabilities.enabled]} />
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
  </div>
}
