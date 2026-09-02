/** Phase D: informational — of the active LedgerTransaction rows dated in the trailing 30 days
 * (ctx.dateRange), what fraction are marked reconciled. requiresLedger: true — unlike
 * submission-volume/automation-rate/processing-time, this has nothing to say for a workspace with
 * no accounting connection at all, so lib/health/registry.ts's runnableChecks skips it entirely the
 * same way it skips every Phase B/C ledger check for such a workspace (rather than emitting a
 * confusing "0% reconciled" finding for data that was never synced). This check's own detail view
 * surfaces that gap itself with a "connect an integration" hint rather than a broken card — see
 * components/health/check-detail.tsx.
 *
 * Category "activity", defaultWeight 0 — see submission-volume.ts's file comment for why a weight-0
 * check can never move lib/health/score.ts's weighted average, and why this always emits one
 * informational finding (whenever it runs at all) rather than gating on "anything to report". */
import type { CheckDefinition, CheckRunResult } from "@/lib/health/types"

export const reconciliationRateCheck: CheckDefinition = {
  code: "reconciliation_rate",
  name: "Reconciliation rate",
  category: "activity",
  defaultWeight: 0,
  requiresLedger: true,
  run: (ctx): CheckRunResult => {
    const transactions = (ctx.ledger?.transactions ?? []).filter(
      (t) => t.active && t.txnDate && t.txnDate >= ctx.dateRange.from && t.txnDate <= ctx.dateRange.to,
    )
    const totalCount = transactions.length
    const reconciledCount = transactions.filter((t) => t.reconciled).length
    const rate = totalCount > 0 ? (reconciledCount / totalCount) * 100 : null

    return {
      applicableCount: 1,
      findings: [{
        checkCode: "reconciliation_rate",
        category: "activity",
        severity: "info",
        title: rate === null ? "No ledger transactions this period" : `${rate.toFixed(0)}% of ledger transactions reconciled`,
        description: totalCount > 0
          ? `${reconciledCount} of ${totalCount} ledger transactions dated in the last 30 days are marked reconciled.`
          : "No ledger transactions are dated in the last 30 days.",
        documentId: null,
        suggestedAction: null,
        suggestedActionPayload: { reconciledCount, totalCount, rate },
        affectedCount: totalCount,
      }],
    }
  },
}
