import { apiError, parseLimit, requireApiAuth } from "@/lib/api-v1"
import { buildApiDocumentListItem } from "@/lib/webhooks"
import { DOCUMENT_STATUSES, PIPELINE_STAGES } from "@/lib/documents/stages"
import { listDocumentsForApi } from "@/models/integrations"

/** GET /api/v1/documents — the Zapier polling trigger. Cursor-paginated, newest first.
 * Query: ?status=&stage=&updated_since=<ISO>&cursor=<id>&limit=<1..100>.
 *
 * `status` is the original filter, unchanged: an exact match on the raw persisted value (see
 * lib/documents/stages.ts — DOCUMENT_STATUSES is exactly the set that has ever actually been
 * written to Document.status). `stage` is additive: the pipeline's Inbox/To review/Ready/
 * Approvals/Archive vocabulary, for a caller that would rather not track individual statuses. */
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

  const statusRaw = url.searchParams.get("status")
  if (statusRaw && !(DOCUMENT_STATUSES as readonly string[]).includes(statusRaw)) return apiError(400, "invalid_status")
  const stageRaw = url.searchParams.get("stage")
  if (stageRaw && !(PIPELINE_STAGES as readonly string[]).includes(stageRaw)) return apiError(400, "invalid_stage")

  const { documents, nextCursor } = await listDocumentsForApi(auth.workspaceId, {
    status: statusRaw ?? undefined,
    stage: stageRaw as (typeof PIPELINE_STAGES)[number] | undefined,
    updatedSince,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: parseLimit(url.searchParams.get("limit"), 50, 100),
  })

  return Response.json({ data: documents.map(buildApiDocumentListItem), next_cursor: nextCursor })
}
