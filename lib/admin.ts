import { getApiUser, getCurrentUser } from "@/lib/auth"
import { User } from "@/prisma/client"
import { notFound } from "next/navigation"

/** The platform role, not a workspace role. WorkspaceMember.role ("owner"/"member") is a
 * different axis entirely — a platform admin is usually a plain member of nothing. */
export const isAdmin = (user: Pick<User, "role"> | null | undefined) => user?.role === "admin"

/** Page/layout guard for /admin.
 *
 * notFound() rather than a bare throw: a throw in a layout escapes that segment's error.tsx and
 * lands on global-error.tsx (the same trap app/(app)/workspaces/[workspaceId]/layout.tsx
 * documents), whereas notFound() and redirect() throw Next's own control-flow signals and are
 * handled properly. A 404 also declines to tell a signed-in customer that /admin exists at all.
 *
 * getCurrentUser re-reads the User row on every request (lib/auth.ts), so a revoked admin loses
 * the console immediately rather than when their 180-day session cookie cache expires. */
export async function requireAdminPage(): Promise<User> {
  const user = await getCurrentUser()
  if (!isAdmin(user)) notFound()
  return user
}

/** The guard for the console's data API — and the one that actually enforces anything.
 *
 * next-admin ships no authorization of its own, and its handler answers every read and write the
 * console performs. The page's requireAdminPage above does not run for those requests, so this is
 * what stands between a signed-in customer who guessed the URL and the whole database. It is
 * installed as the `onRequest` middleware in app/api/admin-next/[[...nextadmin]]/route.ts.
 *
 * Non-throwing on purpose: the caller turns null into the same 404 the pages give, rather than a
 * rejected promise that would surface as a 500 and confirm the route exists. */
export async function requireAdminActor(): Promise<User | null> {
  const user = await getApiUser()
  return isAdmin(user) ? user : null
}
