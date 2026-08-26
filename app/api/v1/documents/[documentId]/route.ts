import { apiError, requireApiAuth } from "@/lib/api-v1"
import { buildApiDocumentResponse } from "@/lib/webhooks"
import { getDocumentForApi } from "@/models/integrations"

/** GET /api/v1/documents/:id — the current state of one document, with its typed field values,
 * confidence and provenance. This is the link webhook payloads point at for fresh state. */
export async function GET(req: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const auth = await requireApiAuth(req)
  if (auth instanceof Response) return auth
  const { documentId } = await params

  const result = await getDocumentForApi(auth.workspaceId, documentId)
  if (!result) return apiError(404, "document_not_found")

  return Response.json(buildApiDocumentResponse(result))
}
