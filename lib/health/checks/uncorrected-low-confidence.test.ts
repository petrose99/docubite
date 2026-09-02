import { describe, expect, it } from "vitest"
import { uncorrectedLowConfidenceCheck } from "@/lib/health/checks/uncorrected-low-confidence"
import type { CheckContext, CheckDocumentSlice } from "@/lib/health/types"

const now = new Date("2026-09-02T00:00:00.000Z")

function doc(id: string): CheckDocumentSlice {
  return { id, fileId: "f1", filename: "a.pdf", templateCode: "invoice", status: "extracted", receivedAt: now, supplierValue: null, supplierConfidence: null, hasPush: false, hasRejectedReviewTask: false }
}

function baseCtx(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    workspaceId: "ws1", dateRange: { from: now, to: now }, ledger: null,
    documents: [], reviewTasks: [], pushHistory: [], automationRules: [], checkResults: [],
    confidenceDrift: [], lowConfidenceFields: [], bankStatements: [],
    ...overrides,
  }
}

describe("uncorrectedLowConfidenceCheck", () => {
  it("passes when nothing is below threshold", () => {
    const result = uncorrectedLowConfidenceCheck.run(baseCtx({ documents: [doc("d1")] }))
    expect(result.findings).toHaveLength(0)
    expect(result.applicableCount).toBe(1)
  })

  it("groups multiple low-confidence fields on one document into one finding", () => {
    const result = uncorrectedLowConfidenceCheck.run(baseCtx({
      documents: [doc("d1")],
      lowConfidenceFields: [
        { documentId: "d1", fieldKey: "total", sourceConfidence: 0.5 },
        { documentId: "d1", fieldKey: "vendor", sourceConfidence: 0.6 },
      ],
    }))
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].description).toContain("2 extracted fields")
  })

  it("produces one finding per affected document", () => {
    const result = uncorrectedLowConfidenceCheck.run(baseCtx({
      documents: [doc("d1"), doc("d2")],
      lowConfidenceFields: [
        { documentId: "d1", fieldKey: "total", sourceConfidence: 0.5 },
        { documentId: "d2", fieldKey: "total", sourceConfidence: 0.5 },
      ],
    }))
    expect(result.findings).toHaveLength(2)
  })
})
