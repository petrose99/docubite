/** Phase D: informational — how many documents were submitted in the trailing 30 days
 * (ctx.dateRange, same window every Phase A-C check already uses) versus the 30 days before that.
 * Same current-vs-prior-30-day-window shape as confidence-drift.ts, computed in memory over
 * ctx.documents rather than a new raw-SQL query: loadDocuments (models/health.ts) already loads up
 * to CANDIDATE_CAP documents ordered by receivedAt with no date filter, so both windows are already
 * present in the context handed to every check — no new I/O needed.
 *
 * Category "activity", defaultWeight 0: this is a metric card, not a pass/fail defect, and
 * lib/health/score.ts's weighted average excludes a weight-0 entry entirely (it contributes 0 to
 * both the numerator and the denominator), so this check can never move the score. It always
 * produces exactly one informational finding — even with zero documents in either window — so the
 * Activity tab always has a real stat to show rather than an empty state, mirroring
 * review-backlog.ts's "always applicable" posture. */
import type { CheckDefinition, CheckRunResult } from "@/lib/health/types"

export const submissionVolumeCheck: CheckDefinition = {
  code: "submission_volume",
  name: "Document submission volume",
  category: "activity",
  defaultWeight: 0,
  requiresLedger: false,
  run: (ctx): CheckRunResult => {
    const { from, to } = ctx.dateRange
    const windowMs = to.getTime() - from.getTime()
    const priorFrom = new Date(from.getTime() - windowMs)

    const currentCount = ctx.documents.filter((d) => d.receivedAt >= from && d.receivedAt <= to).length
    const priorCount = ctx.documents.filter((d) => d.receivedAt >= priorFrom && d.receivedAt < from).length
    const delta = currentCount - priorCount
    const percentChange = priorCount > 0 ? (delta / priorCount) * 100 : null

    return {
      applicableCount: 1,
      findings: [{
        checkCode: "submission_volume",
        category: "activity",
        severity: "info",
        title: `${currentCount} document${currentCount === 1 ? "" : "s"} submitted in the last 30 days`,
        description: priorCount > 0
          ? `${currentCount} documents this period vs ${priorCount} the prior 30 days (${delta >= 0 ? "+" : ""}${delta}, ${percentChange!.toFixed(0)}%).`
          : `${currentCount} document${currentCount === 1 ? "" : "s"} this period; no submissions in the prior 30 days to compare against.`,
        documentId: null,
        suggestedAction: null,
        suggestedActionPayload: { currentCount, priorCount, delta, percentChange },
        affectedCount: currentCount,
      }],
    }
  },
}
