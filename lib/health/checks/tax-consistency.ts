/** Phase C: a thin wrapper, not new logic — elevates DocumentCheckResult rows already computed by
 * lib/checks/tax-consistency.ts (via models/document-checks.ts's runDeterministicChecks, run once
 * per document at extraction/reprocess time) into HealthCheckResult findings, exactly the way
 * push_failures.ts elevates IntegrationPush rows. The subtotal × rate-in-force comparison itself is
 * NOT reimplemented here — ctx.checkResults (models/health.ts's loadCheckResults) already carries
 * every non-"pass" tax_consistency row for the workspace; this just turns each one into a finding.
 * requiresLedger: true per the plan (tax checks need the ledger context to run at all), even though
 * this particular check's own data doesn't come from the ledger — it stays consistent with the
 * other three tax checks so it only ever runs for a workspace with an active accounting
 * connection, matching how the Tax tab is scoped. */
import type { CheckDefinition, CheckRunResult } from "@/lib/health/types"

export const taxConsistencyHealthCheck: CheckDefinition = {
  code: "tax_consistency",
  name: "Tax doesn't match the expected rate",
  category: "tax",
  defaultWeight: 1,
  requiresLedger: true,
  run: (ctx): CheckRunResult => {
    const rows = ctx.checkResults.filter((row) => row.checkCode === "tax_consistency" && row.status !== "pass")
    const applicableCount = rows.length
    if (!applicableCount) return { findings: [], applicableCount }

    const findings = rows.map((row) => ({
      checkCode: "tax_consistency",
      category: "tax" as const,
      severity: row.status === "fail" ? ("critical" as const) : ("warning" as const),
      title: "Tax total doesn't match the expected rate",
      description: "This document's tax total doesn't match the rate in force for its date under this workspace's tax profile — see the document's own check results for the expected amount.",
      documentId: row.documentId,
      suggestedAction: null,
      suggestedActionPayload: null,
      affectedCount: 1,
    }))

    return { findings, applicableCount }
  },
}
