/** Flags a document that has sat for more than 30 days with no accounting push and no rejected
 * review — it neither left the pipeline (pushed) nor was explicitly kicked back (rejected), so it
 * is just... stale. One finding per document. */
import type { CheckDefinition, CheckRunResult } from "@/lib/health/types"

export const STALE_DOCUMENT_AGE_DAYS = 30

function daysOld(receivedAt: Date, now: Date): number {
  return (now.getTime() - receivedAt.getTime()) / (24 * 60 * 60 * 1000)
}

export const staleDocumentsCheck: CheckDefinition = {
  code: "stale_documents",
  name: "Stale documents",
  category: "pipeline",
  defaultWeight: 1,
  requiresLedger: false,
  run: (ctx): CheckRunResult => {
    const applicableCount = ctx.documents.length
    if (!applicableCount) return { findings: [], applicableCount }

    const stale = ctx.documents.filter((document) =>
      daysOld(document.receivedAt, ctx.dateRange.to) > STALE_DOCUMENT_AGE_DAYS &&
      !document.hasPush &&
      !document.hasRejectedReviewTask,
    )

    const findings = stale.map((document) => ({
      checkCode: "stale_documents",
      category: "pipeline" as const,
      severity: "warning" as const,
      title: `"${document.filename}" has been sitting for over ${STALE_DOCUMENT_AGE_DAYS} days`,
      description: `Received ${Math.floor(daysOld(document.receivedAt, ctx.dateRange.to))} days ago, never pushed and never rejected.`,
      documentId: document.id,
      suggestedAction: "open_document",
      suggestedActionPayload: null,
      affectedCount: 1,
    }))

    return { findings, applicableCount }
  },
}
