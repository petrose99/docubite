/** Phase D: informational — of the documents received in the trailing 30 days (ctx.dateRange),
 * what fraction were coded automatically by an AutomationRule (CheckDocumentSlice.hasAppliedRule,
 * from Document.appliedRuleId) versus needed a person to code them. Same in-memory-over-ctx.documents
 * approach as submission-volume.ts — no new query.
 *
 * Category "activity", defaultWeight 0 — see submission-volume.ts's file comment for why a weight-0
 * check can never move lib/health/score.ts's weighted average, and why this always emits one
 * informational finding rather than gating on "anything to report". */
import type { CheckDefinition, CheckRunResult } from "@/lib/health/types"

export const automationRateCheck: CheckDefinition = {
  code: "automation_rate",
  name: "Automation rate",
  category: "activity",
  defaultWeight: 0,
  requiresLedger: false,
  run: (ctx): CheckRunResult => {
    const periodDocs = ctx.documents.filter((d) => d.receivedAt >= ctx.dateRange.from && d.receivedAt <= ctx.dateRange.to)
    const totalCount = periodDocs.length
    const automatedCount = periodDocs.filter((d) => d.hasAppliedRule).length
    const manualCount = totalCount - automatedCount
    const rate = totalCount > 0 ? (automatedCount / totalCount) * 100 : null

    return {
      applicableCount: 1,
      findings: [{
        checkCode: "automation_rate",
        category: "activity",
        severity: "info",
        title: rate === null ? "No documents processed this period" : `${rate.toFixed(0)}% of documents auto-coded by a rule`,
        description: totalCount > 0
          ? `${automatedCount} of ${totalCount} documents received in the last 30 days were coded automatically by an automation rule; ${manualCount} needed manual coding.`
          : "No documents were received in the last 30 days.",
        documentId: null,
        suggestedAction: null,
        suggestedActionPayload: { automatedCount, manualCount, totalCount, rate },
        affectedCount: totalCount,
      }],
    }
  },
}
