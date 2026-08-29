import { default as globalConfig } from "@/lib/config"
import { buildCsp, generateNonce } from "@/lib/csp"
import { updateSession } from "@/lib/supabase/middleware"
import { NextRequest, NextResponse } from "next/server"

/** Runs on (almost) every request — see the matcher below — to keep the Supabase session cookie
 * refreshed, enforce the idle-timeout automatic logoff (see lib/supabase/middleware.ts — a Free
 * Supabase plan has no dashboard equivalent), and bounce a signed-out visitor away from the two
 * prefixes that require a session.
 *
 * The broad matcher, not just /workspaces and /admin-next as before, is deliberate: a session
 * whose access token expires while the visitor sits on a public or marketing page would otherwise
 * carry a stale token into the first protected navigation, and Supabase's own refresh (and the
 * idle-timeout check) only happen where this middleware runs. The cost is a JWT verification
 * (local, via JWKS — no round trip to Supabase for a project using the default asymmetric signing
 * keys) on every matched request; that's the trade Supabase's own docs recommend this exact
 * matcher shape for.
 *
 * /shared/[fileId], /invite/[token], and every marketing/auth page all pass through this
 * unredirected — updateSession still refreshes their cookie if they happen to have one (a
 * workspace member previewing their own shared link, say), but userId being null on those routes
 * is the normal, expected case. */
const PROTECTED_PREFIXES = ["/workspaces", "/admin-next"]

export async function proxy(request: NextRequest) {
  // Set before updateSession runs: it builds its response via NextResponse.next({ request }) off
  // this same request object, so mutating request.headers here is what gets x-nonce to the actual
  // page render — Next.js auto-nonces the inline scripts it injects when it sees this header.
  const nonce = generateNonce()
  request.headers.set("x-nonce", nonce)

  const { response, userId } = await updateSession(request)
  const isProtected = PROTECTED_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix))
  let result = response
  if (isProtected && !userId) {
    // The redirect must carry updateSession's cookie writes (a refreshed token, or the idle path's
    // sign-out clearing the session + last-seen cookies) — building a bare redirect here once
    // dropped them, leaving the browser with a stale last-seen cookie that marked every FRESH
    // login idle on its first protected request, sign-out revoking it server-side each time: a
    // permanent, self-sustaining login loop. See lib/supabase/middleware.ts's warning that every
    // caller must return its response's cookies.
    result = NextResponse.redirect(new URL(globalConfig.auth.loginUrl, request.url))
    for (const cookie of response.headers.getSetCookie()) result.headers.append("set-cookie", cookie)
  }

  // Report-Only until CSP_ENFORCE=true: soak on real traffic first, since `'strict-dynamic'` is
  // only as safe as the nonce actually reaching every script Next.js emits — see lib/csp.ts.
  const cspHeaderName = globalConfig.security.cspEnforce ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only"
  result.headers.set(cspHeaderName, buildCsp(nonce))
  return result
}

/** /admin-next's real guards are requireAdminPage (the console page) and requireAdminActor (the
 * onRequest middleware on the data API) in lib/admin.ts — this only confirms a session exists at
 * all, the same UX-shortcut role it played under better-auth. The platform `role` check still has
 * to happen where Prisma is reachable, which the edge runtime this file runs in is not. */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js)$).*)"],
}
