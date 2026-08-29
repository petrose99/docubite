import config from "@/lib/config"
import { createServerClient } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

/** F2/§164.312(a)(2)(iii) automatic logoff, enforced here rather than left to Supabase's own
 * Inactivity Timeout setting — that setting exists, but is gated to the Pro plan and above, and a
 * Free-plan project (the one this migration was verified against) has no dashboard control for it
 * at all. This cookie is the app-level equivalent: unencrypted since it holds nothing but a
 * timestamp, and readable only from this middleware and never from client JS (httpOnly).
 *
 * If the Supabase project is later upgraded to Pro and its own Inactivity Timeout is configured,
 * the two enforce the same policy redundantly — harmless, and worth keeping this one regardless
 * so the control does not silently depend on plan tier. */
const LAST_SEEN_COOKIE = "docubite-last-seen"

export function isIdle(request: NextRequest, lastSignInAt?: string | null): boolean {
  const lastSeen = request.cookies.get(LAST_SEEN_COOKIE)?.value
  if (!lastSeen) return false // first request on a fresh session — nothing to compare against yet
  const lastSeenMs = Number(lastSeen)
  if (!Number.isFinite(lastSeenMs)) return false
  // A sign-in newer than the last-seen timestamp means this is a fresh session, not a stale one
  // left idle: the cookie predates the login (it survives sign-out — httpOnly, so the login page
  // cannot clear it) and must not be allowed to kill the session the user just created.
  if (lastSignInAt) {
    const signedInMs = Date.parse(lastSignInAt)
    if (Number.isFinite(signedInMs) && signedInMs > lastSeenMs) return false
  }
  return Date.now() - lastSeenMs > config.auth.idleTimeoutMinutes * 60_000
}

function touchLastSeen(response: NextResponse) {
  response.cookies.set(LAST_SEEN_COOKIE, String(Date.now()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  })
}

/** Refreshes the Supabase session for one request and returns both the (possibly-rewritten)
 * response carrying the refreshed cookies and the authenticated user, if any.
 *
 * `supabase.auth.getUser()` is called immediately after the client is constructed, with nothing
 * in between — Supabase's own migration guide is explicit that inserting logic there causes
 * hard-to-debug random logouts, because it is the getUser() call itself that triggers the token
 * refresh whose result setAll below needs to persist. Every caller MUST return the `response` this
 * returns (or a NextResponse built from it), never a bare NextResponse.next() — that would drop
 * the refreshed cookies and the browser would keep sending an expired token.
 *
 * The idle check runs AFTER getUser() specifically so a session that has already gone idle is
 * signed out (revoking the refresh token server-side, not just dropping the cookie locally) rather
 * than quietly left valid for whoever holds the browser. */
export async function updateSession(request: NextRequest): Promise<{ response: NextResponse; userId: string | null }> {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(config.supabase.url, config.supabase.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options)
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { response, userId: null }

  if (isIdle(request, user.last_sign_in_at)) {
    await supabase.auth.signOut()
    response.cookies.delete(LAST_SEEN_COOKIE)
    return { response, userId: null }
  }

  touchLastSeen(response)
  return { response, userId: user.id }
}
