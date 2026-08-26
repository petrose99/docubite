import { randomBytes } from "crypto"
import { prisma } from "@/lib/db"
import type { Prisma } from "@/prisma/client"
import { generateApiKey } from "@/lib/api-key"
import { getWorkspacePlan } from "@/lib/plans"
import { encryptSecret } from "@/lib/secret-crypto"
import { assertUrlSafe } from "@/lib/url-safety"
import { isWebhookEventType } from "@/lib/webhooks"
import { getDocumentFieldValues } from "@/models/document-field-values"

/** Whether the workspace's plan includes the integrations surface. Distinct from the deployment
 * gate (config.integrations.enabled): a deployment can have integrations configured while a
 * particular workspace is on a plan (a future free tier) that excludes them. */
export async function workspaceIntegrationsPlanEnabled(workspaceId: string): Promise<boolean> {
  const sub = await prisma.workspaceSubscription.findUnique({ where: { workspaceId }, select: { planCode: true } })
  return getWorkspacePlan(sub?.planCode || "starter").integrations
}

/** The data layer for the integrations surface (P1): API keys, webhook endpoints, delivery history,
 * and the API-shaped document reads that /api/v1 serves. Every query is workspace-scoped. Secrets are
 * generated and sealed here (crypto lives in lib/); the plaintext is returned exactly once, to the
 * caller that created it, and never persisted. */

// --- API keys ---

/** Never selects keyHash — it is write-only. keyPrefix is the safe display label. */
export async function listWorkspaceApiKeys(workspaceId: string) {
  return prisma.workspaceApiKey.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, keyPrefix: true, lastUsedAt: true, revokedAt: true, createdAt: true },
  })
}

export async function createWorkspaceApiKey(workspaceId: string, input: { name: string; createdById: string }) {
  const key = generateApiKey()
  const record = await prisma.workspaceApiKey.create({
    data: { workspaceId, name: input.name.trim() || "API key", keyHash: key.keyHash, keyPrefix: key.keyPrefix, createdById: input.createdById },
    select: { id: true, name: true, keyPrefix: true, createdAt: true },
  })
  // The one and only time the plaintext exists outside the caller's request.
  return { plaintext: key.plaintext, record }
}

export async function revokeWorkspaceApiKey(workspaceId: string, keyId: string) {
  const res = await prisma.workspaceApiKey.updateMany({ where: { id: keyId, workspaceId, revokedAt: null }, data: { revokedAt: new Date() } })
  if (!res.count) throw new Error("api_key_not_found")
}

// --- Webhook endpoints ---

function generateWebhookSecret(): string {
  return "whsec_" + randomBytes(24).toString("base64url")
}

export async function listWorkspaceWebhookEndpoints(workspaceId: string) {
  return prisma.webhookEndpoint.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: { id: true, url: true, events: true, status: true, failureCount: true, createdAt: true },
  })
}

export async function createWorkspaceWebhookEndpoint(workspaceId: string, input: { url: string; events?: string[]; createdById?: string }) {
  // Validated here so registration fails fast on an unsafe or unreachable URL — checked AGAIN at
  // delivery time (DNS can change). Throws UnsafeUrlError, surfaced to the caller as an error code.
  await assertUrlSafe(input.url)
  const events = input.events ?? []
  const cleanEvents = events.filter(isWebhookEventType)
  if (events.length !== cleanEvents.length) throw new Error("invalid_event_type")
  const secret = generateWebhookSecret()
  const endpoint = await prisma.webhookEndpoint.create({
    // createdById omitted (null) for API-key-created endpoints; the settings UI passes the user.
    data: { workspaceId, url: input.url, events: cleanEvents, secretEnc: encryptSecret(secret), createdById: input.createdById || null },
    select: { id: true, url: true, events: true, status: true, createdAt: true },
  })
  return { secret, endpoint }
}

export async function deleteWorkspaceWebhookEndpoint(workspaceId: string, endpointId: string) {
  const res = await prisma.webhookEndpoint.deleteMany({ where: { id: endpointId, workspaceId } })
  if (!res.count) throw new Error("webhook_endpoint_not_found")
}

/** Owner toggles an endpoint on/off. Re-enabling resets failureCount so a fixed endpoint starts
 * clean rather than one failure away from being auto-disabled again. */
export async function setWorkspaceWebhookEndpointStatus(workspaceId: string, endpointId: string, status: "active" | "disabled") {
  const res = await prisma.webhookEndpoint.updateMany({
    where: { id: endpointId, workspaceId },
    data: status === "active" ? { status, failureCount: 0 } : { status },
  })
  if (!res.count) throw new Error("webhook_endpoint_not_found")
}

// --- Delivery history ---

export async function listWorkspaceWebhookDeliveries(workspaceId: string, limit = 50) {
  return prisma.webhookDelivery.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true, endpointId: true, eventId: true, eventType: true, status: true, attempts: true,
      responseStatus: true, errorCode: true, nextAttemptAt: true, deliveredAt: true, createdAt: true,
    },
  })
}

/** Requeues a delivery for a full fresh retry cycle (attempts reset to 0, due now). Idempotent-safe:
 * a delivery to a since-disabled endpoint will simply fail again as endpoint_disabled. */
export async function redeliverWorkspaceWebhookDelivery(workspaceId: string, deliveryId: string) {
  const res = await prisma.webhookDelivery.updateMany({
    where: { id: deliveryId, workspaceId },
    data: { status: "pending", attempts: 0, nextAttemptAt: new Date(), leaseUntil: null, errorCode: null, responseStatus: null, deliveredAt: null },
  })
  if (!res.count) throw new Error("delivery_not_found")
}

// --- API-shaped document reads (served by /api/v1) ---

/** Cursor-paginated document list — the Zapier polling trigger. Ordered newest-first by receivedAt
 * then id (id breaks ties and is the stable cursor). `cursor` is the last id of the previous page. */
export async function listDocumentsForApi(
  workspaceId: string,
  filters: { status?: string; updatedSince?: Date; cursor?: string; limit?: number } = {}
) {
  const take = Math.min(Math.max(filters.limit ?? 50, 1), 100)
  const where: Prisma.DocumentWhereInput = {
    workspaceId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.updatedSince ? { updatedAt: { gte: filters.updatedSince } } : {}),
  }
  const rows = await prisma.document.findMany({
    where,
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: take + 1, // over-fetch one to know if there's a next page
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    include: { template: true },
  })
  const hasMore = rows.length > take
  const documents = hasMore ? rows.slice(0, take) : rows
  return { documents, nextCursor: hasMore ? documents[documents.length - 1]?.id ?? null : null }
}

export async function getDocumentForApi(workspaceId: string, documentId: string) {
  const document = await prisma.document.findFirst({ where: { id: documentId, workspaceId }, include: { template: true } })
  if (!document) return null
  const fieldValues = await getDocumentFieldValues(workspaceId, documentId)
  return { document, fieldValues }
}
