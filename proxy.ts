import { default as globalConfig } from "@/lib/config"
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
  const { response, userId } = await updateSession(request)
  const isProtected = PROTECTED_PREFIXES.some((prefix) => request.nextUrl.pathname.startsWith(prefix))
  if (isProtected && !userId) return NextResponse.redirect(new URL(globalConfig.auth.loginUrl, request.url))
  return response
}

/** /admin-next's real guards are requireAdminPage (the console page) and requireAdminActor (the
 * onRequest middleware on the data API) in lib/admin.ts — this only confirms a session exists at
 * all, the same UX-shortcut role it played under better-auth. The platform `role` check still has
 * to happen where Prisma is reachable, which the edge runtime this file runs in is not. */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js)$).*)"],
}
