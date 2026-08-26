import config from "@/lib/config"
import { getViewerUser } from "@/lib/auth"
import { getOrCreateWorkspaceForUser } from "@/models/workspaces"
import { redirect } from "next/navigation"

/** There is no workspace picker — this route resolves the user's workspace and forwards to its
 * Files list, creating the first one on demand. `/` is the home page and no longer forwards, so
 * this is the entry point used after login and by the Stripe return URLs (lib/config.ts).
 *
 * Now goes through getViewerUser rather than a bare session read: this is the very first page a
 * brand-new sign-up or a just-migrated user's first post-reset login lands on, and provisioning
 * the local User row only happens inside getViewerUser's resolveOrProvisionUser call — reading
 * the session directly here, as under better-auth (which auto-created the row on sign-in itself),
 * would find no row yet and bounce straight back to login. */
export default async function WorkspacesPage() {
  const user = await getViewerUser()
  if (!user) redirect(config.auth.loginUrl)
  const workspace = await getOrCreateWorkspaceForUser(user)
  redirect(`/workspaces/${workspace.id}/files`)
}

export const dynamic = "force-dynamic"
