import { getSession } from "@/lib/auth"
import config from "@/lib/config"
import { getUserById } from "@/models/users"
import { getOrCreateWorkspaceForUser } from "@/models/workspaces"
import { redirect } from "next/navigation"

/** There is no workspace picker — this route resolves the user's workspace and forwards to its
 * Files list, creating the first one on demand. `/` is the home page and no longer forwards, so
 * this is the entry point used after login and by the Stripe return URLs (lib/config.ts).
 *
 * Left reading the session directly rather than going through getViewerUser, so it is the one
 * path that does not itself refuse a suspended account. Harmless, and not worth changing: it
 * only ever redirects, and every destination sits under a layout whose getCurrentUser() does
 * apply the check — so a suspended user lands back on the login page a hop later either way. */
export default async function WorkspacesPage() {
  const session = await getSession()
  if (!session) redirect(config.auth.loginUrl)
  const user = await getUserById(session.user.id)
  if (!user) redirect(config.auth.loginUrl)
  const workspace = await getOrCreateWorkspaceForUser(user)
  redirect(`/workspaces/${workspace.id}/files`)
}

export const dynamic = "force-dynamic"
