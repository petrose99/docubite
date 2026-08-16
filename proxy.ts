import { default as globalConfig } from "@/lib/config"
import { getSessionCookie } from "better-auth/cookies"
import { NextRequest, NextResponse } from "next/server"

export function proxy(request: NextRequest) {
  if (!getSessionCookie(request, { cookiePrefix: "docubite" })) return NextResponse.redirect(new URL(globalConfig.auth.loginUrl, request.url))
  return NextResponse.next()
}

/** /admin-next is here for the same reason /workspaces is, and buys exactly as little:
 * getSessionCookie checks that a cookie is *present*, not that it is valid, and Prisma is not
 * available on the edge runtime — so the platform role cannot be checked here at all. This is a UX
 * shortcut that sends a signed-out visitor to the login page instead of rendering a shell first.
 * The real guards are requireAdminPage (the console page) and requireAdminActor (the onRequest
 * middleware on the data API) in lib/admin.ts. */
export const config = { matcher: ["/workspaces/:path*", "/admin-next/:path*"] }
