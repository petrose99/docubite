import { describe, expect, it } from "vitest"
import { duplicateContactsCheck } from "@/lib/health/checks/duplicate-contacts"
import type { CheckContext, LedgerAccountingEntitySlice } from "@/lib/health/types"

const now = new Date("2026-09-02T00:00:00.000Z")

function vendor(overrides: Partial<LedgerAccountingEntitySlice> = {}): LedgerAccountingEntitySlice {
  return { id: "id1", externalId: "v1", entityType: "vendor", name: "Acme Ltd", active: true, ...overrides }
}

function baseCtx(accountingEntities: LedgerAccountingEntitySlice[]): CheckContext {
  return {
    workspaceId: "ws1", dateRange: { from: now, to: now },
    ledger: { transactions: [], accountingEntities, matchCandidateDocuments: [] },
    documents: [], reviewTasks: [], pushHistory: [], automationRules: [], checkResults: [],
    confidenceDrift: [], lowConfidenceFields: [], bankStatements: [],
  }
}

describe("duplicateContactsCheck", () => {
  it("flags vendors whose names normalize to the same string", () => {
    const result = duplicateContactsCheck.run(baseCtx([
      vendor({ id: "id1", externalId: "v1", name: "Acme Ltd" }),
      vendor({ id: "id2", externalId: "v2", name: "Acme, Ltd." }),
    ]))
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].affectedCount).toBe(2)
  })

  it("does not flag distinctly named vendors", () => {
    const result = duplicateContactsCheck.run(baseCtx([
      vendor({ id: "id1", externalId: "v1", name: "Acme Ltd" }),
      vendor({ id: "id2", externalId: "v2", name: "Widgets Inc" }),
    ]))
    expect(result.findings).toHaveLength(0)
  })

  it("ignores inactive vendors", () => {
    const result = duplicateContactsCheck.run(baseCtx([
      vendor({ id: "id1", externalId: "v1", name: "Acme Ltd", active: false }),
      vendor({ id: "id2", externalId: "v2", name: "Acme Ltd" }),
    ]))
    expect(result.applicableCount).toBe(1)
    expect(result.findings).toHaveLength(0)
  })

  it("reports zero applicable when there are no vendors", () => {
    const result = duplicateContactsCheck.run(baseCtx([]))
    expect(result.applicableCount).toBe(0)
  })
})
