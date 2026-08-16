import { options } from "@/app/admin-next/next-admin-options"
import { requireAdminActor } from "@/lib/admin"
import { prisma } from "@/lib/db"
import type { PrismaClient } from "@premieroctet/next-admin"
import { createHandler } from "@premieroctet/next-admin/appHandler"

/** next-admin's data API.
 *
 * Mounted at /api/admin-next, NOT at the documented /api/[[...nextadmin]]. That path is a
 * catch-all at the root of the API namespace and would swallow /api/auth/*, /api/stripe/*,
 * /api/documents/* and /api/files/* — every existing route in the app.
 *
 * onRequest is the real authorization boundary. The page's requireAdminPage() does not run for
 * these requests, and every read and write next-admin performs arrives here — so without this,
 * mounting the console would expose the entire database to any signed-in user who guessed the
 * URL. requireAdminActor re-reads the User row, so a demoted or suspended admin loses access on
 * their next request rather than when their session cookie expires. */
const { run } = createHandler({
  apiBasePath: "/api/admin-next",
  prisma: prisma as unknown as PrismaClient,
  options,
  onRequest: async () => {
    if (await requireAdminActor()) return
    // Same 404 the pages give a non-admin: the console does not confirm it exists.
    return Response.json({ error: "not_found" }, { status: 404 })
  },
})

/** next-admin types its handler's context as `{ nextadmin: string[] }`, but an *optional*
 * catch-all in Next 16 is typed `string[] | undefined` — the segment is genuinely absent at
 * /admin-next itself. The shapes are compatible at runtime (the handler reads the array
 * defensively); only the declaration disagrees, so the export is retyped rather than the route
 * being downgraded to a required catch-all, which would 404 the console's own index page. */
type RouteHandler = (request: Request, context: { params: Promise<{ nextadmin?: string[] }> }) => Promise<Response>

const handler = run as unknown as RouteHandler

export { handler as DELETE, handler as GET, handler as POST }
