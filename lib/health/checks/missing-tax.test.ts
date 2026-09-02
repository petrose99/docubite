import { describe, expect, it } from "vitest"
import { missingTaxCheck } from "@/lib/health/checks/missing-tax"
import type { CheckContext, CheckDocumentSlice } from "@/lib/health/types"

const now = new Date("2026-09-02T00:00:00.000Z")

function doc(overrides: Partial<CheckDocumentSlice> = {}): CheckDocumentSlice {
  return {
    id: "d1", fileId: "f1", filename: "invoice.pdf", templateCode: "invoice", status: "extracted",
    receivedAt: now, supplierValue: "Acme", supplierConfidence: null, hasPush: true, hasRejectedReviewTask: false,
    taxExpected: true, extractedTaxTotal: 10,
    ...overrides,
  }
}

function baseCtx(documents: CheckDocumentSlice[]): CheckContext {
  return {
    workspaceId: "ws1", dateRange: { from: now, to: now }, ledger: { transactions: [], accountingEntities: [], matchCandidateDocuments: [] },
    documents, reviewTasks: [], pushHistory: [], automationRules: [], checkResults: [],
    confidenceDrift: [], lowConfidenceFields: [], bankStatements: [],
  }
}

describe("missingTaxCheck", () => {
  it("passes when tax was extracted", () => {
    const result = missingTaxCheck.run(baseCtx([doc()]))
    expect(result.findings).toHaveLength(0)
    expect(result.applicableCount).toBe(1)
  })

  it("flags a pushed document with no tax total, when tax is expected", () => {
    const result = missingTaxCheck.run(baseCtx([doc({ extractedTaxTotal: null })]))
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].severity).toBe("warning")
  })

  it("ignores a document whose template/workspace has no tax expectation", () => {
    const result = missingTaxCheck.run(baseCtx([doc({ extractedTaxTotal: null, taxExpected: false })]))
    expect(result.applicableCount).toBe(0)
    expect(result.findings).toHaveLength(0)
  })

  it("ignores an unpushed document even with tax expected", () => {
    const result = missingTaxCheck.run(baseCtx([doc({ extractedTaxTotal: null, hasPush: false })]))
    expect(result.applicableCount).toBe(0)
  })
})
