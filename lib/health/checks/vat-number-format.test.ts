import { describe, expect, it } from "vitest"
import { vatNumberFormatCheck } from "@/lib/health/checks/vat-number-format"
import type { CheckContext, CheckResultSlice } from "@/lib/health/types"

const now = new Date("2026-09-02T00:00:00.000Z")

function baseCtx(checkResults: CheckResultSlice[]): CheckContext {
  return {
    workspaceId: "ws1", dateRange: { from: now, to: now }, ledger: { transactions: [], accountingEntities: [], matchCandidateDocuments: [] },
    documents: [], reviewTasks: [], pushHistory: [], automationRules: [], checkResults,
    confidenceDrift: [], lowConfidenceFields: [], bankStatements: [],
  }
}

describe("vatNumberFormatCheck", () => {
  it("elevates a warn DocumentCheckResult row into a finding", () => {
    const result = vatNumberFormatCheck.run(baseCtx([{ documentId: "d1", checkCode: "vat_number_format", status: "warn" }]))
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].documentId).toBe("d1")
    expect(result.findings[0].severity).toBe("warning")
  })

  it("ignores a pass row", () => {
    const result = vatNumberFormatCheck.run(baseCtx([{ documentId: "d1", checkCode: "vat_number_format", status: "pass" }]))
    expect(result.findings).toHaveLength(0)
    expect(result.applicableCount).toBe(0)
  })

  it("ignores rows for a different check code", () => {
    const result = vatNumberFormatCheck.run(baseCtx([{ documentId: "d1", checkCode: "tax_consistency", status: "warn" }]))
    expect(result.findings).toHaveLength(0)
  })
})
