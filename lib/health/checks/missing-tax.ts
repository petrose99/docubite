/** Phase C: flags a pushed document with no tax field extracted at all, for a template/workspace
 * where tax is normally expected — CheckDocumentSlice.taxExpected (set by models/health.ts's
 * loadDocuments) is true exactly when the document's template has a tax_total concept AND the
 * workspace has a TaxProfile configured (models/tax-profiles.ts's getTaxProfile) at all; a
 * workspace that never set up a tax region has no such expectation, and a template with no tax
 * field (e.g. purchase_order) is simply not eligible. requiresLedger: true because this only makes
 * sense for a document that actually made it into the ledger — an unpushed document's missing tax
 * is review-inbox territory (uncorrected_low_confidence.ts), not a ledger-health concern. */
import type { CheckDefinition, CheckRunResult } from "@/lib/health/types"

export const missingTaxCheck: CheckDefinition = {
  code: "missing_tax",
  name: "Pushed document has no tax total",
  category: "tax",
  defaultWeight: 1,
  requiresLedger: true,
  run: (ctx): CheckRunResult => {
    const candidates = ctx.documents.filter((document) => document.hasPush && document.taxExpected)
    const applicableCount = candidates.length
    if (!applicableCount) return { findings: [], applicableCount }

    const missing = candidates.filter((document) => document.extractedTaxTotal === null || document.extractedTaxTotal === undefined)
    const findings = missing.map((document) => ({
      checkCode: "missing_tax",
      category: "tax" as const,
      severity: "warning" as const,
      title: `No tax total extracted for ${document.filename}`,
      description: "This document was pushed to the ledger, but no tax total was extracted from it — this workspace's tax profile expects one for this document type.",
      documentId: document.id,
      suggestedAction: null,
      suggestedActionPayload: null,
      affectedCount: 1,
    }))

    return { findings, applicableCount }
  },
}
