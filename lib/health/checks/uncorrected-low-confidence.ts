/** Flags a document with an extracted field read at less than 70% confidence that nobody has
 * reviewed — `ctx.lowConfidenceFields` is already the `document_field_values.source_confidence <
 * 0.7` × "no resolved/approved review_task for this document" join (models/health.ts), so this
 * check only groups it by document. One finding per document, not per field: a document with three
 * shaky fields is one thing to go look at, not three. */
import type { CheckDefinition, CheckRunResult } from "@/lib/health/types"

export const LOW_CONFIDENCE_THRESHOLD = 0.7

export const uncorrectedLowConfidenceCheck: CheckDefinition = {
  code: "uncorrected_low_confidence",
  name: "Uncorrected low-confidence fields",
  category: "pipeline",
  defaultWeight: 1.5,
  requiresLedger: false,
  run: (ctx): CheckRunResult => {
    // The population evaluated is every document the run looked at — that's the denominator a
    // pass/fail rate needs; ctx.lowConfidenceFields is already only the failing rows.
    const applicableCount = ctx.documents.length

    const byDocument = new Map<string, number>()
    for (const field of ctx.lowConfidenceFields) byDocument.set(field.documentId, (byDocument.get(field.documentId) ?? 0) + 1)

    const findings = Array.from(byDocument.entries()).map(([documentId, count]) => ({
      checkCode: "uncorrected_low_confidence",
      category: "pipeline" as const,
      severity: "warning" as const,
      title: count === 1 ? "One field was read with low confidence" : `${count} fields were read with low confidence`,
      description: `This document has ${count} extracted field${count === 1 ? "" : "s"} below ${Math.round(LOW_CONFIDENCE_THRESHOLD * 100)}% confidence with no review recorded.`,
      documentId,
      suggestedAction: "open_document",
      suggestedActionPayload: null,
      affectedCount: 1,
    }))

    return { findings, applicableCount }
  },
}
