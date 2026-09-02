/** Phase C: a thin wrapper, not new logic — elevates DocumentCheckResult rows already computed by
 * lib/checks/vat-number.ts (via models/document-checks.ts's runDeterministicChecks) into
 * HealthCheckResult findings, the same pattern lib/health/checks/tax-consistency.ts uses for its
 * sibling check. The format-matching itself is NOT reimplemented here — ctx.checkResults
 * (models/health.ts's loadCheckResults) already carries every non-"pass" vat_number_format row for
 * the workspace. requiresLedger: true for the same reason as tax-consistency.ts: kept consistent
 * with the other tax checks so this only ever runs for a workspace with an active connection. */
import type { CheckDefinition, CheckRunResult } from "@/lib/health/types"

export const vatNumberFormatCheck: CheckDefinition = {
  code: "vat_number_format",
  name: "Supplier VAT number format",
  category: "tax",
  defaultWeight: 1,
  requiresLedger: true,
  run: (ctx): CheckRunResult => {
    const rows = ctx.checkResults.filter((row) => row.checkCode === "vat_number_format" && row.status !== "pass")
    const applicableCount = rows.length
    if (!applicableCount) return { findings: [], applicableCount }

    const findings = rows.map((row) => ({
      checkCode: "vat_number_format",
      category: "tax" as const,
      severity: "warning" as const,
      title: "Supplier VAT number format looks wrong",
      description: "This document's supplier VAT number doesn't match the expected format for this workspace's tax region.",
      documentId: row.documentId,
      suggestedAction: null,
      suggestedActionPayload: null,
      affectedCount: 1,
    }))

    return { findings, applicableCount }
  },
}
