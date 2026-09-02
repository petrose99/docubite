/** Phase D: informational — mean/median wall-clock time from a document's receivedAt to whichever
 * came first: a person resolving its review (CheckDocumentSlice.reviewedAt, from
 * Document.reviewedAt) or its first successful IntegrationPush (ctx.pushHistory, status
 * "succeeded" — updatedAt is the closest thing CheckPushSlice carries to a completion timestamp,
 * since IntegrationPush.updatedAt is stamped on every status transition including the one into
 * "succeeded"). Only documents received in the trailing 30 days (ctx.dateRange) that have actually
 * reached one of those two end states count toward the sample — a document still mid-pipeline has
 * no processing time yet, not a processing time of zero.
 *
 * Category "activity", defaultWeight 0 — see submission-volume.ts's file comment for why a weight-0
 * check can never move lib/health/score.ts's weighted average, and why this always emits one
 * informational finding rather than gating on "anything to report". */
import type { CheckDefinition, CheckRunResult } from "@/lib/health/types"

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** ms -> a short human string, minutes under an hour, hours under 2 days, days beyond that. */
export function formatDurationMs(ms: number): string {
  const hours = ms / (60 * 60 * 1000)
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60000))}m`
  if (hours < 48) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)}d`
}

export const processingTimeCheck: CheckDefinition = {
  code: "processing_time",
  name: "Processing time",
  category: "activity",
  defaultWeight: 0,
  requiresLedger: false,
  run: (ctx): CheckRunResult => {
    const periodDocs = ctx.documents.filter((d) => d.receivedAt >= ctx.dateRange.from && d.receivedAt <= ctx.dateRange.to)

    const durationsMs: number[] = []
    for (const document of periodDocs) {
      const succeededPush = ctx.pushHistory.find((p) => p.documentId === document.id && p.status === "succeeded")
      const completedAt = document.reviewedAt ?? succeededPush?.updatedAt ?? null
      if (!completedAt) continue
      const durationMs = completedAt.getTime() - document.receivedAt.getTime()
      if (durationMs >= 0) durationsMs.push(durationMs)
    }
    durationsMs.sort((a, b) => a - b)

    const sampleSize = durationsMs.length
    const meanMs = sampleSize ? durationsMs.reduce((sum, v) => sum + v, 0) / sampleSize : null
    const medianMs = sampleSize ? median(durationsMs) : null

    return {
      applicableCount: 1,
      findings: [{
        checkCode: "processing_time",
        category: "activity",
        severity: "info",
        title: sampleSize ? `Median time to review: ${formatDurationMs(medianMs as number)}` : "No completed documents this period",
        description: sampleSize
          ? `Based on ${sampleSize} document${sampleSize === 1 ? "" : "s"} received in the last 30 days and either reviewed or auto-published: mean ${formatDurationMs(meanMs as number)}, median ${formatDurationMs(medianMs as number)}.`
          : "No documents received in the last 30 days have been reviewed or auto-published yet.",
        documentId: null,
        suggestedAction: null,
        suggestedActionPayload: { meanMs, medianMs, sampleSize },
        affectedCount: sampleSize,
      }],
    }
  },
}
