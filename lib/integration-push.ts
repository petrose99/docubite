import config from "@/lib/config"
import { prisma } from "@/lib/db"
import { unscoped } from "@/lib/workspace-scope"
import { getValidAccessToken, TokenRefreshError } from "@/lib/integration-token-refresh"
import { NormalizedBill } from "@/lib/integration-bill-mapping"
import { IntegrationAuthError, IntegrationPermanentError, safeErrorCode } from "@/lib/integrations/errors"
import * as quickbooks from "@/lib/integrations/quickbooks/client"
import { toQuickBooksBillBody } from "@/lib/integrations/quickbooks/bill-mapper"
import * as xero from "@/lib/integrations/xero/client"
import { toXeroBillBody } from "@/lib/integrations/xero/bill-mapper"
import * as bigcapital from "@/lib/integrations/bigcapital/client"
import { toBigcapitalBillBody } from "@/lib/integrations/bigcapital/bill-mapper"
import { computePushUpdate, PUSH_LEASE_MS, type PushAttemptResult } from "@/lib/integration-push-policy"

/** The push loop: claim a due IntegrationPush, resolve the vendor/contact + default expense account
 * at the provider, create the bill, and apply the pure policy's verdict (succeeded / retry-with-
 * backoff / give up). Modelled on lib/webhook-delivery.ts's claim/process/drain trio exactly, with
 * its own smaller lease and attempt cap (see lib/integration-push-policy.ts). Never throws for an
 * ordinary provider failure — every failure path is caught and recorded on the row. */

/** Picks and atomically claims the next due push. Returns its id, or null if nothing is due or
 * another drain won the race. Not wrapped in unscoped() itself — callers do that once around a loop,
 * exactly as claimNextWebhookDelivery does. */
export async function claimNextIntegrationPush(now = new Date()): Promise<string | null> {
  const dueLease = { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }
  const candidate = await prisma.integrationPush.findFirst({
    where: { status: "pending", nextAttemptAt: { lte: now }, ...dueLease },
    orderBy: { nextAttemptAt: "asc" },
    select: { id: true },
  })
  if (!candidate) return null
  const claimed = await prisma.integrationPush.updateMany({
    where: { id: candidate.id, status: "pending", ...dueLease },
    data: { leaseUntil: new Date(now.getTime() + PUSH_LEASE_MS) },
  })
  return claimed.count ? candidate.id : null
}

/** WP2.4: checks the provider's own ledger for a bill/invoice already carrying this document's
 * reference number, before ever creating one — a duplicate this app's own detection can't see
 * (e.g. the same invoice pushed once from here and once entered by hand at the provider). Never
 * throws: a lookup failure (network blip, transient provider error) must not block a push that
 * would otherwise succeed, so this swallows any error and reports "not a duplicate" rather than
 * risk false-blocking every push whenever the lookup itself is flaky. */
async function ledgerHasDuplicate(provider: string, externalTenantId: string | null, accessToken: string, referenceNumber: string): Promise<boolean> {
  if (!externalTenantId) return false
  try {
    switch (provider) {
      case "quickbooks":
        return await quickbooks.findBillByDocNumber(externalTenantId, accessToken, referenceNumber)
      case "xero":
        return await xero.findBillByInvoiceNumber(externalTenantId, accessToken, referenceNumber)
      case "bigcapital":
        return await bigcapital.findBillByReferenceNumber(accessToken, externalTenantId, referenceNumber)
      default:
        return false
    }
  } catch (error) {
    console.error("[integration-push] ledger duplicate lookup failed, proceeding with push:", error instanceof Error ? error.message : error)
    return false
  }
}

async function pushToQuickbooks(realmId: string, accessToken: string, bill: NormalizedBill, accountId: string): Promise<{ id: string }> {
  const vendorRef = await quickbooks.findOrCreateVendor(realmId, accessToken, bill.vendorName)
  const body = toQuickBooksBillBody(bill, vendorRef, accountId)
  return quickbooks.createBill(realmId, accessToken, body)
}

async function pushToXero(tenantId: string, accessToken: string, bill: NormalizedBill, accountCode: string): Promise<{ id: string }> {
  const contactId = await xero.findOrCreateContact(tenantId, accessToken, bill.vendorName)
  const body = toXeroBillBody(bill, contactId, accountCode)
  return xero.createBill(tenantId, accessToken, body)
}

async function pushToBigcapital(organizationId: string, apiKey: string, bill: NormalizedBill, accountId: string): Promise<{ id: string }> {
  // Bigcapital bill lines reference a catalog Item, not an account directly (confirmed live — an
  // entry with no item_id is rejected) — findOrCreateExpenseItem maps the connection's configured
  // default expense account onto one generic, reusable item.
  const [vendorId, itemId] = await Promise.all([
    bigcapital.findOrCreateVendor(apiKey, organizationId, bill.vendorName),
    bigcapital.findOrCreateExpenseItem(apiKey, organizationId, accountId),
  ])
  const body = toBigcapitalBillBody(bill, vendorId, itemId)
  return bigcapital.createBill(apiKey, organizationId, body)
}

/** Attempts one claimed push and records the outcome. Safe to call on a row another driver may also
 * try, exactly like deliverWebhook. */
export async function attemptIntegrationPush(pushId: string, now = new Date()): Promise<void> {
  const push = await prisma.integrationPush.findUnique({
    where: { id: pushId },
    select: {
      id: true, workspaceId: true, status: true, attempts: true, payload: true,
      connection: {
        select: {
          id: true, provider: true, status: true, externalTenantId: true,
          defaultExpenseAccountId: true,
        },
      },
    },
  })
  if (!push || push.status !== "pending") return
  const connection = push.connection

  let result: PushAttemptResult
  let forceTerminal = false

  if (connection.status !== "active") {
    result = { success: false, errorCode: connection.status === "needs_reauth" ? "integration_needs_reauth" : "integration_connection_disabled", externalBillId: null }
    forceTerminal = true
  } else if (!connection.externalTenantId || !connection.defaultExpenseAccountId) {
    result = { success: false, errorCode: "integration_default_account_not_configured", externalBillId: null }
    forceTerminal = true
  } else {
    try {
      const bill = { ...(push.payload as unknown as NormalizedBill), currencyCode: (push.payload as unknown as NormalizedBill).currencyCode ?? null }
      const accessToken = await getValidAccessToken(connection.id, now)
      const isDuplicate = bill.referenceNumber ? await ledgerHasDuplicate(connection.provider, connection.externalTenantId, accessToken, bill.referenceNumber) : false
      if (isDuplicate) throw new IntegrationPermanentError("ledger_duplicate")
      let created: { id: string }
      switch (connection.provider) {
        case "quickbooks":
          created = await pushToQuickbooks(connection.externalTenantId, accessToken, bill, connection.defaultExpenseAccountId)
          break
        case "xero":
          created = await pushToXero(connection.externalTenantId, accessToken, bill, connection.defaultExpenseAccountId)
          break
        case "bigcapital":
          created = await pushToBigcapital(connection.externalTenantId, accessToken, bill, connection.defaultExpenseAccountId)
          break
        default:
          throw new IntegrationPermanentError(`${connection.provider}_push_not_implemented`)
      }
      result = { success: true, errorCode: null, externalBillId: created.id }
    } catch (error) {
      if (error instanceof TokenRefreshError) {
        result = { success: false, errorCode: error.message, externalBillId: null }
        forceTerminal = error.message === "integration_needs_reauth"
      } else if (error instanceof IntegrationAuthError) {
        // Reached only if the provider rejects an access token the refresh layer believed valid
        // (e.g. revoked between refresh and use) — treat the same as needs_reauth, terminal.
        result = { success: false, errorCode: safeErrorCode(error), externalBillId: null }
        forceTerminal = true
        await prisma.integrationConnection.update({ where: { id: connection.id }, data: { status: "needs_reauth" } }).catch(() => {})
      } else if (error instanceof IntegrationPermanentError) {
        result = { success: false, errorCode: error.code, externalBillId: null }
        forceTerminal = true
      } else {
        result = { success: false, errorCode: safeErrorCode(error), externalBillId: null }
      }
    }
  }

  const update = computePushUpdate(push.attempts, result, now, forceTerminal)
  await prisma.integrationPush.update({ where: { id: push.id }, data: update })
}

/** Claim + attempt the next due push. Returns its id if one ran, null if the queue was empty.
 * Unscoped: it spans workspaces like the webhook drain, so it wraps the scope guard exactly as
 * processNextWebhookDelivery does. */
export async function processNextIntegrationPush(now = new Date()): Promise<string | null> {
  return unscoped(async () => {
    const id = await claimNextIntegrationPush(now)
    if (!id) return null
    await attemptIntegrationPush(id, now)
    return id
  })
}

/** Drains up to `max` due pushes in one pass, stopping early when the queue empties. */
export async function drainIntegrationPushes(max = 20): Promise<number> {
  let processed = 0
  for (let i = 0; i < max; i++) {
    const id = await processNextIntegrationPush()
    if (!id) break
    processed++
  }
  return processed
}

/** Fire-and-forget nudge to drain the push queue right after one is enqueued, mirroring
 * kickWebhookDrain exactly — best-effort, swallowed on failure, backed by the cron/worker safety
 * net. */
export async function kickIntegrationPushDrain(): Promise<void> {
  try {
    await fetch(`${config.app.baseURL}/api/internal/jobs/process`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.aws.internalWorkerSecret}` },
      body: JSON.stringify({ drainIntegrationPushes: true }),
      signal: AbortSignal.timeout(5000),
    })
  } catch { /* swallowed: the drain drivers are the guarantee, this is only latency */ }
}
