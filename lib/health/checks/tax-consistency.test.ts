import { describe, expect, it } from "vitest"
import { taxConsistencyHealthCheck } from "@/lib/health/checks/tax-consistency"
import type { CheckContext, CheckResultSlice } from "@/lib/health/types"

const now = new Date("2026-09-02T00:00:00.000Z")

function baseCtx(checkResults: CheckResultSlice[]): CheckContext {
  return {
    workspaceId: "ws1", dateRange: { from: now, to: now }, ledger: { transactions: [], accountingEntities: [], matchCandidateDocuments: [] },
    documents: [], reviewTasks: [], pushHistory: [], automationRules: [], checkResults,
    confidenceDrift: [], lowConfidenceFields: [], bankStatements: [],
  }
}

describe("taxConsistencyHealthCheck", () => {
  it("elevates a warn DocumentCheckResult row into a warning finding", () => {
    const result = taxConsistencyHealthCheck.run(baseCtx([{ documentId: "d1", checkCode: "tax_consistency", status: "warn" }]))
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].severity).toBe("warning")
    expect(result.findings[0].documentId).toBe("d1")
  })

  it("elevates a fail row to critical", () => {
    const result = taxConsistencyHealthCheck.run(baseCtx([{ documentId: "d1", checkCode: "tax_consistency", status: "fail" }]))
    expect(result.findings[0].severity).toBe("critical")
  })

  it("ignores a pass row", () => {
    const result = taxConsistencyHealthCheck.run(baseCtx([{ documentId: "d1", checkCode: "tax_consistency", status: "pass" }]))
    expect(result.findings).toHaveLength(0)
    expect(result.applicableCount).toBe(0)
  })

  it("ignores rows for a different check code (e.g. vat_number_format)", () => {
    const result = taxConsistencyHealthCheck.run(baseCtx([{ documentId: "d1", checkCode: "vat_number_format", status: "warn" }]))
    expect(result.findings).toHaveLength(0)
  })
})
