import config from "@/lib/config"
import { getViewerUser } from "@/lib/auth"
import { getWorkspacesForUser } from "@/models/workspaces"
import { redirect } from "next/navigation"

/** There is no workspace picker — this route resolves the user's workspace and forwards to its
 * Files list. `/` is the home page and no longer forwards, so this is the entry point used after
 * login and by the Stripe return URLs (lib/config.ts).
 *
 * A brand-new user (zero memberships — never an invited member, since accepting an invitation
 * already creates one) is sent to the industry picker instead of getting a silently-created
 * "general" workspace: /workspaces/new is what actually creates it, with an industry chosen
 * instead of defaulted. getOrCreateWorkspaceForUser's own lazy-creation fallback (models/workspaces.ts)
 * still exists as a safety net for any other path that resolves a workspace outside this page.
 *
 * Goes through getViewerUser rather than a bare session read: this is the very first page a
 * brand-new sign-up or a just-migrated user's first post-reset login lands on, and provisioning
 * the local User row only happens inside getViewerUser's resolveOrProvisionUser call — reading
 * the session directly here, as under better-auth (which auto-created the row on sign-in itself),
 * would find no row yet and bounce straight back to login. */
export default async function WorkspacesPage() {
  const user = await getViewerUser()
  if (!user) redirect(config.auth.loginUrl)
  const memberships = await getWorkspacesForUser(user.id)
  if (!memberships.length) redirect("/workspaces/new")
  redirect(`/workspaces/${memberships[0].id}/files`)
}

export const dynamic = "force-dynamic"
