import { TeamWorkspaceForm } from "@/components/workspace/team-workspace-form"
import { getViewerUser } from "@/lib/auth"
import config from "@/lib/config"
import { getWorkspacesForUser } from "@/models/workspaces"
import { redirect } from "next/navigation"

/** A full page rather than the switcher's old inline popover form — the industry picker's card
 * grid needs more room than the switcher's w-64 popover gives it. Every workspace-creation path
 * (this one, and /workspaces/new for a brand-new user's first workspace) goes through the same
 * picker so no workspace is ever silently created with a locked-in "general" industry. */
export default async function CreateWorkspacePage() {
  const user = await getViewerUser()
  if (!user) redirect(config.auth.loginUrl)
  const memberships = await getWorkspacesForUser(user.id)

  return <main className="mx-auto max-w-4xl space-y-8 p-8">
    <header className="space-y-1 text-center">
      <h1 className="text-2xl font-bold text-stone-900">Create a workspace</h1>
      <p className="text-sm text-muted-foreground">Pick the closest fit — you can enable more from Settings later, and this can&apos;t be changed once the workspace has files.</p>
    </header>
    <TeamWorkspaceForm billingWorkspaceId={memberships[0]?.id} />
  </main>
}

export const dynamic = "force-dynamic"
