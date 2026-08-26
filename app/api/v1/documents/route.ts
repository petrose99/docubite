import { apiError, parseLimit, requireApiAuth } from "@/lib/api-v1"
import { buildApiDocumentListItem } from "@/lib/webhooks"
import { listDocumentsForApi } from "@/models/integrations"

/** GET /api/v1/documents — the Zapier polling trigger. Cursor-paginated, newest first.
 * Query: ?status=&updated_since=<ISO>&cursor=<id>&limit=<1..100>. */
export async function GET(req: Request) {
  const auth = await requireApiAuth(req)
  if (auth instanceof Response) return auth

  const url = new URL(req.url)
  const updatedSinceRaw = url.searchParams.get("updated_since")
  let updatedSince: Date | undefined
  if (updatedSinceRaw) {
    const parsed = new Date(updatedSinceRaw)
    if (Number.isNaN(parsed.getTime())) return apiError(400, "invalid_updated_since")
    updatedSince = parsed
  }

  const { documents, nextCursor } = await listDocumentsForApi(auth.workspaceId, {
    status: url.searchParams.get("status") ?? undefined,
    updatedSince,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: parseLimit(url.searchParams.get("limit"), 50, 100),
  })

  return Response.json({ data: documents.map(buildApiDocumentListItem), next_cursor: nextCursor })
}
