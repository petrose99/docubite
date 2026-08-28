import { NewWorkspaceForm } from "@/components/workspace/new-workspace-form"
import config from "@/lib/config"
import { getViewerUser } from "@/lib/auth"
import { getWorkspacesForUser } from "@/models/workspaces"
import { redirect } from "next/navigation"

/** The industry picker a brand-new user lands on instead of a silently-created "general"
 * workspace — see app/(app)/workspaces/page.tsx's redirect. An invited member never reaches here
 * (accepting an invitation already creates a membership), and anyone who already has a workspace
 * — including one created here a moment ago on a back-button revisit — is bounced to it instead of
 * being offered a second one. */
export default async function NewWorkspacePage() {
  const user = await getViewerUser()
  if (!user) redirect(config.auth.loginUrl)
  const memberships = await getWorkspacesForUser(user.id)
  if (memberships.length) redirect(`/workspaces/${memberships[0].id}/files`)

  return <main className="mx-auto max-w-4xl space-y-8 p-8">
    <header className="space-y-1 text-center">
      <h1 className="text-2xl font-bold text-stone-900">What will you use DocuBite for?</h1>
      <p className="text-sm text-muted-foreground">Pick the closest fit — you can enable more from Settings later, and this can&apos;t be changed once the workspace has files.</p>
    </header>
    <NewWorkspaceForm defaultName={`${user.name || user.email}'s workspace`} />
  </main>
}

export const dynamic = "force-dynamic"
