import config from "@/lib/config"
import { prisma } from "@/lib/db"
import { decryptSecret } from "@/lib/secret-crypto"
import { unscoped } from "@/lib/workspace-scope"
import { buildSignatureHeader } from "@/lib/webhook-signature"
import { assertUrlSafe, UnsafeUrlError } from "@/lib/url-safety"
import {
  computeDeliveryUpdate,
  DELIVERY_LEASE_MS,
  isSuccessStatus,
  type DeliveryAttemptResult,
} from "@/lib/webhook-delivery-policy"

/** The delivery loop: claim a due WebhookDelivery, POST it (signed, SSRF-guarded), and apply the
 * pure policy's verdict (delivered / retry-with-backoff / give up, plus endpoint auto-disable).
 *
 * Modelled on the DocumentProcessingJob drain but with its own short lease: `leaseUntil` marks a row
 * in-flight without a separate "processing" status (the delivery machine is pending|delivered|failed).
 * A candidate is picked by `findFirst` and claimed by an `updateMany` guarded on status+lease, so two
 * racing drains never double-send. Drained by three drivers — the after()-commit kick, the internal
 * jobs route, and the worker loop — exactly as embeds are. */

const DELIVERY_TIMEOUT_MS = 10_000
const RESPONSE_SNIPPET_BYTES = 1024 // read at most this much of a receiver's body (for logging)

/** Picks and atomically claims the next due delivery. Returns its id, or null if nothing is due or
 * another drain won the race. Not wrapped in unscoped() itself — callers do that once around a loop. */
export async function claimNextWebhookDelivery(now = new Date()): Promise<string | null> {
  const dueLease = { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }
  const candidate = await prisma.webhookDelivery.findFirst({
    where: { status: "pending", nextAttemptAt: { lte: now }, ...dueLease },
    orderBy: { nextAttemptAt: "asc" },
    select: { id: true },
  })
  if (!candidate) return null
  const claimed = await prisma.webhookDelivery.updateMany({
    where: { id: candidate.id, status: "pending", ...dueLease },
    data: { leaseUntil: new Date(now.getTime() + DELIVERY_LEASE_MS) },
  })
  return claimed.count ? candidate.id : null
}

async function attemptPost(url: string, rawBody: string, headers: Record<string, string>): Promise<DeliveryAttemptResult> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: rawBody,
      // A 3xx is a failure, never a followed redirect: an open redirect could otherwise land the POST
      // on an internal host the SSRF check already cleared the original URL of.
      redirect: "manual",
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    })
    // Drain and discard a bounded prefix of the body so the socket can be reused; we never need it.
    try {
      const reader = response.body?.getReader()
      if (reader) {
        let read = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          read += value?.byteLength ?? 0
          if (read >= RESPONSE_SNIPPET_BYTES) { await reader.cancel(); break }
        }
      }
    } catch { /* body drain is best-effort */ }
    const success = isSuccessStatus(response.status)
    return { success, responseStatus: response.status, errorCode: success ? null : `http_${response.status}` }
  } catch (error) {
    // Timeout, DNS, connection refused, TLS failure — all indistinguishable retryable transport errors.
    const errorCode = error instanceof Error && error.name === "TimeoutError" ? "delivery_timeout" : "delivery_request_failed"
    return { success: false, responseStatus: null, errorCode }
  }
}

/** Delivers one claimed delivery and records the outcome. Safe to call on a row another driver may
 * also try: the terminal state write is idempotent enough (last writer wins with the same verdict),
 * and the claim lease makes concurrent attempts rare. */
export async function deliverWebhook(deliveryId: string, now = new Date()): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true, workspaceId: true, status: true, attempts: true, eventId: true, eventType: true, payload: true,
      endpoint: { select: { id: true, url: true, secretEnc: true, status: true, failureCount: true } },
    },
  })
  if (!delivery || delivery.status !== "pending") return
  const endpoint = delivery.endpoint

  // An endpoint disabled (auto or by the owner) after this row was queued: stop trying, don't retry.
  if (endpoint.status !== "active") {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "failed", errorCode: "endpoint_disabled", leaseUntil: null, attempts: delivery.attempts + 1 },
    })
    return
  }

  const rawBody = JSON.stringify(delivery.payload)
  let result: DeliveryAttemptResult
  try {
    await assertUrlSafe(endpoint.url)
    const secret = decryptSecret(endpoint.secretEnc)
    const timestamp = Math.floor(now.getTime() / 1000)
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "DocuBite-Webhooks/1",
      "x-docubite-signature": buildSignatureHeader(secret, timestamp, rawBody),
      "x-docubite-event": delivery.eventType,
      "x-docubite-delivery": delivery.id,
    }
    result = await attemptPost(endpoint.url, rawBody, headers)
  } catch (error) {
    // URL turned unsafe (DNS rebinding since registration) or the secret could not be decrypted (key
    // rotated away). Both are failures we record but never POST for.
    const errorCode = error instanceof UnsafeUrlError ? error.code : "secret_decrypt_failed"
    result = { success: false, responseStatus: null, errorCode }
  }

  const update = computeDeliveryUpdate(delivery.attempts, endpoint.failureCount, result, now)
  await prisma.$transaction(async (tx) => {
    await tx.webhookDelivery.update({ where: { id: delivery.id }, data: update.delivery })
    await tx.webhookEndpoint.update({ where: { id: endpoint.id }, data: update.endpoint })
    if (update.disabled) {
      await tx.documentAuditEvent.create({
        data: { workspaceId: delivery.workspaceId, type: "webhook_endpoint_disabled" },
      })
    }
  })
}

/** Claim + deliver the next due delivery. Returns its id if one ran, null if the queue was empty.
 * Unscoped: it spans workspaces like the job drain, so it wraps the scope guard exactly as the job
 * worker does (see lib/workspace-scope.ts). */
export async function processNextWebhookDelivery(now = new Date()): Promise<string | null> {
  return unscoped(async () => {
    const id = await claimNextWebhookDelivery(now)
    if (!id) return null
    await deliverWebhook(id, now)
    return id
  })
}

/** Drains up to `max` due deliveries in one pass, stopping early when the queue empties. Returns how
 * many ran. The internal jobs route and the worker loop both call this. */
export async function drainWebhookDeliveries(max = 20): Promise<number> {
  let processed = 0
  for (let i = 0; i < max; i++) {
    const id = await processNextWebhookDelivery()
    if (!id) break
    processed++
  }
  return processed
}

/** Fire-and-forget nudge to drain the queue right after an event is emitted, so a delivery does not
 * wait for the next cron tick. Best-effort by design — mirrors kickEmbedJob: a dropped kick is
 * covered by the cron/worker safety net, so its failure is swallowed. */
export async function kickWebhookDrain(): Promise<void> {
  try {
    await fetch(`${config.app.baseURL}/api/internal/jobs/process`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.aws.internalWorkerSecret}` },
      body: JSON.stringify({ drainWebhooks: true }),
      signal: AbortSignal.timeout(5000),
    })
  } catch { /* swallowed: the drain drivers are the guarantee, this is only latency */ }
}
