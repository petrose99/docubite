import { apiError, requireApiAuth } from "@/lib/api-v1"
import { kickWebhookDrain } from "@/lib/webhook-delivery"
import { redeliverWorkspaceWebhookDelivery } from "@/models/integrations"

/** POST /api/v1/deliveries/:id/redeliver — requeue a delivery for a fresh retry cycle. */
export async function POST(req: Request, { params }: { params: Promise<{ deliveryId: string }> }) {
  const auth = await requireApiAuth(req)
  if (auth instanceof Response) return auth
  const { deliveryId } = await params
  try {
    await redeliverWorkspaceWebhookDelivery(auth.workspaceId, deliveryId)
  } catch {
    return apiError(404, "delivery_not_found")
  }
  await kickWebhookDrain()
  return Response.json({ ok: true })
}
