import { describe, expect, it } from "vitest"
import { staleDocumentsCheck } from "@/lib/health/checks/stale-documents"
import type { CheckContext, CheckDocumentSlice } from "@/lib/health/types"

const now = new Date("2026-09-02T00:00:00.000Z")

function doc(overrides: Partial<CheckDocumentSlice> = {}): CheckDocumentSlice {
  return { id: "d1", fileId: "f1", filename: "a.pdf", templateCode: "invoice", status: "extracted", receivedAt: now, supplierValue: null, supplierConfidence: null, hasPush: false, hasRejectedReviewTask: false, ...overrides }
}

function baseCtx(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    workspaceId: "ws1", dateRange: { from: now, to: now }, ledger: null,
    documents: [], reviewTasks: [], pushHistory: [], automationRules: [], checkResults: [],
    confidenceDrift: [], lowConfidenceFields: [], bankStatements: [],
    ...overrides,
  }
}

const days = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000)

describe("staleDocumentsCheck", () => {
  it("does not flag a recent document", () => {
    const result = staleDocumentsCheck.run(baseCtx({ documents: [doc({ receivedAt: days(5) })] }))
    expect(result.findings).toHaveLength(0)
  })

  it("flags a document over 30 days old with no push and no rejection", () => {
    const result = staleDocumentsCheck.run(baseCtx({ documents: [doc({ receivedAt: days(31) })] }))
    expect(result.findings).toHaveLength(1)
  })

  it("does not flag an old document that was already pushed", () => {
    const result = staleDocumentsCheck.run(baseCtx({ documents: [doc({ receivedAt: days(31), hasPush: true })] }))
    expect(result.findings).toHaveLength(0)
  })

  it("does not flag an old document that was rejected in review", () => {
    const result = staleDocumentsCheck.run(baseCtx({ documents: [doc({ receivedAt: days(31), hasRejectedReviewTask: true })] }))
    expect(result.findings).toHaveLength(0)
  })
})
