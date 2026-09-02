// Deliberately NOT a "use server" module, matching models/health.ts and every other models/*.ts
// helper: this trusts the workspaceId/actorId it is handed. The "use server" boundary + the
// requireModule/requireWorkspaceRole(["owner"]) gate live in
// app/(app)/workspaces/[workspaceId]/health-actions.ts, same split as every other remediation-ish
// action in this codebase (dismissHealthFinding vs dismissHealthFindingAction).
//
// THIS FILE IS HIGH RISK. voidDuplicate's non-dry-run path calls a provider's voidBill — a real,
// irreversible write against someone's live accounting books. Every export here:
//   1. Only ever acts on a HealthCheckResult row that is still "open" and whose suggestedAction
//      matches the action being invoked — never on an arbitrary id/payload passed in directly.
//   2. Supports dryRun: true, which performs no write and no audit log beyond describing the
//      intended change — see the safety rule in the Phase C brief this file was built from.
//   3. On a real execution, only marks the finding "resolved" (via models/health.ts's
//      resolveHealthFinding) AFTER the write succeeds — a failed write leaves the row "open" and
//      the action returns ok: false, so a person can retry or investigate rather than a silently
//      "fixed" finding that was never actually fixed.
//   4. Audit-logs every real execution attempt (success and failure) via lib/audit.ts's
//      recordDocumentAudit — never recordSystemAudit, since every call here has a real actorId (a
//      human clicked Confirm) and, being a server action, a request behind it.
import { recordDocumentAudit } from "@/lib/audit"
import { attemptIntegrationPush } from "@/lib/integration-push"
import { getValidAccessToken, TokenRefreshError } from "@/lib/integration-token-refresh"
import * as bigcapital from "@/lib/integrations/bigcapital/client"
import * as quickbooks from "@/lib/integrations/quickbooks/client"
import * as xero from "@/lib/integrations/xero/client"
import { prisma } from "@/lib/db"
import { resolveHealthFinding } from "@/models/health"

export type RemediationOutcome = {
  ok: boolean
  /** Echoes the caller's dryRun flag — a dry-run outcome is always ok: true (it never fails; there
   * is nothing to fail at), its message describes what a real execution WOULD do. */
  dryRun: boolean
  message: string
  detail?: Record<string, unknown>
}

function errorMessage(error: unknown): string {
  if (error instanceof TokenRefreshError) return `Could not obtain a valid access token: ${error.message}`
  return error instanceof Error ? error.message : "Unknown error"
}

async function loadOpenFinding(workspaceId: string, findingId: string, expectedAction: string) {
  const finding = await prisma.healthCheckResult.findFirst({
    where: { id: findingId, workspaceId },
    select: { id: true, status: true, documentId: true, suggestedAction: true, suggestedActionPayload: true, externalTransactionId: true },
  })
  if (!finding) return { finding: null, error: "health_finding_not_found" as const }
  if (finding.status !== "open") return { finding: null, error: "health_finding_not_open" as const }
  if (finding.suggestedAction !== expectedAction) return { finding: null, error: "health_finding_action_mismatch" as const }
  return { finding, error: null }
}

// ---- void_duplicate: voids the newer of a pair of near-duplicate ledger bills -----------------

type VoidDuplicatePayload = { otherExternalTransactionId?: string; kind?: string }

export async function executeVoidDuplicate(input: { workspaceId: string; findingId: string; actorId: string; dryRun: boolean }): Promise<RemediationOutcome> {
  const { workspaceId, findingId, actorId, dryRun } = input
  const { finding, error } = await loadOpenFinding(workspaceId, findingId, "void_duplicate")
  if (!finding) return { ok: false, dryRun, message: error ?? "health_finding_not_found" }

  const payload = (finding.suggestedActionPayload ?? {}) as VoidDuplicatePayload
  if (!payload.otherExternalTransactionId) return { ok: false, dryRun, message: "Finding has no transaction to void" }
  // ledger_duplicate.ts only ever sets suggestedAction: "void_duplicate" for a bill-kind pair — this
  // is a second, independent check against the persisted payload (not just trusting the check that
  // produced it), since a stale or hand-crafted payload must not reach a provider's void endpoint
  // for a kind no client here implements voiding for.
  if (payload.kind !== "bill") return { ok: false, dryRun, message: `Voiding is only supported for bills, not "${payload.kind}"` }

  const transaction = await prisma.ledgerTransaction.findFirst({
    where: { workspaceId, externalId: payload.otherExternalTransactionId, kind: "bill" },
    select: { id: true, externalId: true, connectionId: true, docNumber: true, amount: true, currencyCode: true, contactName: true, active: true },
  })
  if (!transaction) return { ok: false, dryRun, message: "Duplicate transaction not found in the synced ledger" }
  if (!transaction.active) return { ok: false, dryRun, message: "That ledger transaction is already inactive" }

  const connection = await prisma.integrationConnection.findUnique({
    where: { id: transaction.connectionId },
    select: { id: true, provider: true, externalTenantId: true, status: true },
  })
  if (!connection || !connection.externalTenantId) return { ok: false, dryRun, message: "Accounting connection not found or not ready" }

  const description = `void bill ${transaction.docNumber ?? transaction.externalId} (${transaction.contactName ?? "unknown contact"}, ${transaction.amount ?? "?"} ${transaction.currencyCode ?? ""}) at ${connection.provider}`

  if (dryRun) {
    return { ok: true, dryRun: true, message: `Dry run: would ${description}. No changes were made.`, detail: { provider: connection.provider, externalBillId: transaction.externalId } }
  }

  try {
    const accessToken = await getValidAccessToken(connection.id)
    switch (connection.provider) {
      case "quickbooks":
        await quickbooks.voidBill(connection.externalTenantId, accessToken, transaction.externalId)
        break
      case "xero":
        await xero.voidBill(connection.externalTenantId, accessToken, transaction.externalId)
        break
      case "bigcapital":
        await bigcapital.voidBill(accessToken, connection.externalTenantId, transaction.externalId)
        break
      default:
        return { ok: false, dryRun: false, message: `Unsupported provider "${connection.provider}"` }
    }

    // The real write succeeded — mark our own cached copy inactive too, so a health run before the
    // next ledger sync doesn't keep seeing (and re-flagging) a transaction that no longer exists at
    // the provider. Best-effort: a failure here does not undo the fact that the void itself
    // succeeded, so it's swallowed rather than turning a successful remediation into a reported
    // failure.
    await prisma.ledgerTransaction.update({ where: { id: transaction.id }, data: { active: false } }).catch(() => {})

    await resolveHealthFinding({ workspaceId, findingId, actorId, action: "void_duplicate" })
    await recordDocumentAudit({
      workspaceId, documentId: finding.documentId, actorId, type: "health_remediation_void_duplicate", outcome: "success",
      detail: { findingId, provider: connection.provider, externalBillId: transaction.externalId },
    })
    return { ok: true, dryRun: false, message: `Voided ${description}.`, detail: { provider: connection.provider, externalBillId: transaction.externalId } }
  } catch (error) {
    // Left "open" on purpose — see the file-level note. A failed void must not read as resolved.
    await recordDocumentAudit({
      workspaceId, documentId: finding.documentId, actorId, type: "health_remediation_void_duplicate", outcome: "failure",
      detail: { findingId, provider: connection.provider, externalBillId: transaction.externalId, error: errorMessage(error) },
    })
    return { ok: false, dryRun: false, message: `Could not void the bill: ${errorMessage(error)}` }
  }
}

// ---- retry_push: re-attempts a failed IntegrationPush group ------------------------------------

type RetryPushPayload = { errorCode?: string; pushIds?: string[] }

export async function executeRetryPush(input: { workspaceId: string; findingId: string; actorId: string; dryRun: boolean }): Promise<RemediationOutcome> {
  const { workspaceId, findingId, actorId, dryRun } = input
  const { finding, error } = await loadOpenFinding(workspaceId, findingId, "retry_push")
  if (!finding) return { ok: false, dryRun, message: error ?? "health_finding_not_found" }

  const payload = (finding.suggestedActionPayload ?? {}) as RetryPushPayload
  const pushIds = payload.pushIds ?? []
  if (!pushIds.length) return { ok: false, dryRun, message: "Finding has no pushes to retry" }

  const pushes = await prisma.integrationPush.findMany({
    where: { id: { in: pushIds }, workspaceId },
    select: { id: true, status: true, attempts: true, documentId: true },
  })
  const stillFailed = pushes.filter((push) => push.status === "failed")
  if (!stillFailed.length) return { ok: false, dryRun, message: "None of these pushes are still in a failed state" }

  if (dryRun) {
    return {
      ok: true, dryRun: true,
      message: `Dry run: would retry ${stillFailed.length} failed push${stillFailed.length === 1 ? "" : "es"} (error: ${payload.errorCode ?? "unknown"}). No changes were made.`,
      detail: { pushIds: stillFailed.map((push) => push.id) },
    }
  }

  // Re-arm each push (clear the lease, reset attempts so it doesn't immediately re-hit the
  // give-up threshold, put it back in "pending") — mirrors lib/integration-push.ts's own claim
  // shape rather than reimplementing its retry/backoff decisions; the actual attempt below reuses
  // attemptIntegrationPush directly instead of re-deriving success/failure logic here.
  await prisma.integrationPush.updateMany({
    where: { id: { in: stillFailed.map((push) => push.id) } },
    data: { status: "pending", attempts: 0, leaseUntil: null, nextAttemptAt: new Date(), errorCode: null },
  })

  const results = await Promise.all(stillFailed.map(async (push) => {
    try {
      await attemptIntegrationPush(push.id)
    } catch (attemptError) {
      console.error("[health-actions] retry_push attempt threw:", attemptError instanceof Error ? attemptError.message : attemptError)
    }
    const updated = await prisma.integrationPush.findUnique({ where: { id: push.id }, select: { status: true } })
    return { pushId: push.id, status: updated?.status ?? "unknown" }
  }))

  const succeeded = results.filter((r) => r.status === "succeeded")
  const stillFailing = results.filter((r) => r.status !== "succeeded")

  await recordDocumentAudit({
    workspaceId, documentId: finding.documentId, actorId, type: "health_remediation_retry_push",
    outcome: stillFailing.length ? "failure" : "success",
    detail: { findingId, results },
  })

  if (stillFailing.length) {
    // Left "open" on purpose — see the file-level note. Partial or total failure must not read as
    // resolved; a person can retry again or investigate the errorCode.
    return {
      ok: false, dryRun: false,
      message: `${succeeded.length} of ${results.length} push(es) succeeded; ${stillFailing.length} still failing.`,
      detail: { results },
    }
  }

  await resolveHealthFinding({ workspaceId, findingId, actorId, action: "retry_push" })
  return { ok: true, dryRun: false, message: `Retried and succeeded on all ${succeeded.length} push(es).`, detail: { results } }
}
