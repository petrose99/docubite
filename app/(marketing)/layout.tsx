import { MarketingFooter } from "@/components/marketing/footer"
import { MarketingNav } from "@/components/marketing/nav"
import { getSession } from "@/lib/auth"
import { getUserBySupabaseUserId } from "@/models/users"
import { getWorkspacesForUser } from "@/models/workspaces"

/** Reads the session directly rather than through getCurrentUser(), which redirects anonymous
 * visitors to the login page — that would make the entire marketing site unreachable to exactly
 * the people it exists for. Workspaces are only listed, never created: browsing the site has no
 * side effects, and /workspaces still mints the first one on demand.
 *
 * getUserBySupabaseUserId, not getUserById: session.user.id is the Supabase identity id, not the
 * local users.id, since the Supabase migration. This intentionally skips resolveOrProvisionUser
 * (unlike getViewerUser) — a first-ever visit before the local row is provisioned just shows the
 * signed-out nav, which is a fine outcome for a marketing page and cheaper than provisioning one
 * on every anonymous pageview. */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  const user = session ? await getUserBySupabaseUserId(session.user.id) : null
  const workspace = user ? (await getWorkspacesForUser(user.id))[0] : null
  const workspaceHref = user ? (workspace ? `/workspaces/${workspace.id}/files` : "/workspaces") : undefined

  return (
    <div className="flex min-h-screen flex-col bg-white text-stone-900">
      <MarketingNav workspaceHref={workspaceHref} />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  )
}

export const dynamic = "force-dynamic"
