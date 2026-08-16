import { MarketingFooter } from "@/components/marketing/footer"
import { MarketingNav } from "@/components/marketing/nav"
import { getSession } from "@/lib/auth"
import { getUserById } from "@/models/users"
import { getWorkspacesForUser } from "@/models/workspaces"

/** Reads the session directly rather than through getCurrentUser(), which redirects anonymous
 * visitors to the login page — that would make the entire marketing site unreachable to exactly
 * the people it exists for. Workspaces are only listed, never created: browsing the site has no
 * side effects, and /workspaces still mints the first one on demand. */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  const user = session ? await getUserById(session.user.id) : null
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
