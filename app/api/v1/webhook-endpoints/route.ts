import { apiError, requireApiAuth } from "@/lib/api-v1"
import { UnsafeUrlError } from "@/lib/url-safety"
import { createWorkspaceWebhookEndpoint, listWorkspaceWebhookEndpoints } from "@/models/integrations"

/** GET  /api/v1/webhook-endpoints — list this workspace's endpoints (no secrets).
 *  POST /api/v1/webhook-endpoints — Zapier REST-hooks subscribe. Body: { url, events?: string[] }.
 *  The signing secret is returned ONCE here and never again. */
export async function GET(req: Request) {
  const auth = await requireApiAuth(req)
  if (auth instanceof Response) return auth
  return Response.json({ data: await listWorkspaceWebhookEndpoints(auth.workspaceId) })
}

export async function POST(req: Request) {
  const auth = await requireApiAuth(req)
  if (auth instanceof Response) return auth

  const body = (await req.json().catch(() => null)) as { url?: unknown; events?: unknown } | null
  if (!body || typeof body.url !== "string") return apiError(400, "url_required")
  const events = Array.isArray(body.events) ? body.events.filter((e): e is string => typeof e === "string") : undefined

  try {
    // API-key-created endpoints have no human creator (createdById omitted → null).
    const { secret, endpoint } = await createWorkspaceWebhookEndpoint(auth.workspaceId, { url: body.url, events })
    return Response.json({ ...endpoint, secret }, { status: 201 })
  } catch (error) {
    if (error instanceof UnsafeUrlError) return apiError(400, error.code)
    if (error instanceof Error && error.message === "invalid_event_type") return apiError(400, "invalid_event_type")
    throw error
  }
}
