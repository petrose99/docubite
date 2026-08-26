import { apiError, requireApiAuth } from "@/lib/api-v1"
import { deleteWorkspaceWebhookEndpoint, listWorkspaceWebhookEndpoints } from "@/models/integrations"

/** GET    /api/v1/webhook-endpoints/:id — one endpoint (no secret).
 *  DELETE /api/v1/webhook-endpoints/:id — Zapier REST-hooks unsubscribe. */
export async function GET(req: Request, { params }: { params: Promise<{ endpointId: string }> }) {
  const auth = await requireApiAuth(req)
  if (auth instanceof Response) return auth
  const { endpointId } = await params
  const endpoint = (await listWorkspaceWebhookEndpoints(auth.workspaceId)).find((e) => e.id === endpointId)
  if (!endpoint) return apiError(404, "webhook_endpoint_not_found")
  return Response.json(endpoint)
}

export async function DELETE(req: Request, { params }: { params: Promise<{ endpointId: string }> }) {
  const auth = await requireApiAuth(req)
  if (auth instanceof Response) return auth
  const { endpointId } = await params
  try {
    await deleteWorkspaceWebhookEndpoint(auth.workspaceId, endpointId)
    return new Response(null, { status: 204 })
  } catch {
    return apiError(404, "webhook_endpoint_not_found")
  }
}
