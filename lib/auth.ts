import config from "@/lib/config"
import { createClient } from "@/lib/supabase/server"
import { resolveOrProvisionUser } from "@/models/users"
import { User } from "@/prisma/client"
import { redirect } from "next/navigation"
import { cache } from "react"

export type UserProfile = Pick<User, "id" | "name" | "email" | "avatar">

/** The verified Supabase identity for this request, or null — cheap to call repeatedly within one
 * request because React's cache() memoizes it, the same pattern models/users.ts uses for its DB
 * lookups.
 *
 * getClaims(), not getUser(): for a project using the default asymmetric signing keys, claims are
 * verified locally against the cached JWKS with no round trip to Supabase, where getUser() always
 * makes one. proxy.ts's updateSession() already made that one round-trip per request (it's what
 * refreshes the token), so a second one here would just double the latency for no extra safety —
 * the claims are still cryptographically verified, not trusted off the cookie unchecked.
 *
 * Returns the Supabase user id (`sub`) as `user.id` — this is NOT the local `users.id` from
 * Postgres. Every caller that needs the local row goes through getViewerUser() (or
 * getUserBySupabaseUserId directly), never getUserById(session.user.id) as it would have been
 * under better-auth, where the two ids were the same value. */
export const getSession = cache(async () => {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data) return null
  const claims = data.claims
  return {
    user: { id: claims.sub, email: (claims.email as string) ?? "", name: (claims.user_metadata as Record<string, unknown> | undefined)?.name as string | undefined },
    aal: (claims.aal as string | undefined) ?? "aal1",
  }
})

export async function getCurrentUser(): Promise<User> {
  const user = await getApiUser()
  if (user) return user
  redirect(config.auth.loginUrl)
}

/** getCurrentUser for route handlers that answer fetch() rather than a navigation. The redirect
 * that getCurrentUser issues turns an expired session into a 307 to the login page, so the
 * caller's `await response.json()` chokes on HTML instead of seeing an auth failure. Returning
 * null lets the route answer 401 JSON.
 *
 * The user is re-read from the database rather than trusted from the session: `role` is on the
 * User row, not the JWT, so a revoked admin loses the exemption on their very next request
 * regardless of how long the session cookie itself remains valid. */
export async function getApiUser(): Promise<User | null> {
  return getViewerUser()
}

/** Resolves the signed-in User row from the session, or null — and it is where account
 * suspension is enforced.
 *
 * One check in one place is the whole point: every page, layout, server action and route handler
 * reaches the current user through this (via getApiUser or getCurrentUser), so a suspended
 * account loses all of them at once rather than one gate at a time.
 *
 * Also where a Supabase identity is first linked to (or provisioned as) a local User row — see
 * models/users.ts's resolveOrProvisionUser for the three cases that covers: already linked,
 * migrated-account-first-sign-in, and genuinely new.
 *
 * Exported for the handful of callers that resolve a viewer without requiring one: the shared
 * link routes and the invitation page, which have to work for signed-out visitors and so cannot
 * use getCurrentUser. They previously inlined `session?.user ? getUserById(...) : null`, which
 * would have walked straight past a suspension. */
export async function getViewerUser(): Promise<User | null> {
  const session = await getSession()
  if (!session?.user) return null
  const user = await resolveOrProvisionUser({ supabaseUserId: session.user.id, email: session.user.email, name: session.user.name })
  if (!user || user.suspendedAt) return null
  return user
}
