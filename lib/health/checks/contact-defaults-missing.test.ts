import { describe, expect, it } from "vitest"
import { contactDefaultsMissingCheck } from "@/lib/health/checks/contact-defaults-missing"
import type { CheckContext } from "@/lib/health/types"

const now = new Date("2026-09-02T00:00:00.000Z")

function baseCtx(): CheckContext {
  return {
    workspaceId: "ws1", dateRange: { from: now, to: now },
    ledger: { transactions: [], accountingEntities: [{ id: "id1", externalId: "v1", entityType: "vendor", name: "Acme", active: true }], matchCandidateDocuments: [] },
    documents: [], reviewTasks: [], pushHistory: [], automationRules: [], checkResults: [],
    confidenceDrift: [], lowConfidenceFields: [], bankStatements: [],
  }
}

describe("contactDefaultsMissingCheck", () => {
  it("is a no-op: always zero applicable, since no cached field carries default account/tax rate data", () => {
    const result = contactDefaultsMissingCheck.run(baseCtx())
    expect(result.applicableCount).toBe(0)
    expect(result.findings).toHaveLength(0)
  })
})
