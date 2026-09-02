import { describe, expect, it } from "vitest"
import { automationRateCheck } from "@/lib/health/checks/automation-rate"
import type { CheckContext, CheckDocumentSlice } from "@/lib/health/types"

const to = new Date("2026-09-02T00:00:00.000Z")
const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)

function doc(id: string, overrides: Partial<CheckDocumentSlice> = {}): CheckDocumentSlice {
  return {
    id, fileId: `f${id}`, filename: `doc-${id}.pdf`, templateCode: "invoice", status: "extracted",
    receivedAt: new Date(from.getTime() + 1000), supplierValue: null, supplierConfidence: null,
    hasPush: false, hasRejectedReviewTask: false, hasAppliedRule: false,
    ...overrides,
  }
}

function baseCtx(documents: CheckDocumentSlice[]): CheckContext {
  return {
    workspaceId: "ws1", dateRange: { from, to }, ledger: null,
    documents, reviewTasks: [], pushHistory: [], automationRules: [], checkResults: [],
    confidenceDrift: [], lowConfidenceFields: [], bankStatements: [],
  }
}

describe("automationRateCheck", () => {
  it("is always applicable and produces exactly one informational finding", () => {
    const result = automationRateCheck.run(baseCtx([]))
    expect(result.applicableCount).toBe(1)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].title).toBe("No documents processed this period")
  })

  it("computes the rate of rule-coded documents in the period", () => {
    const documents = [doc("1", { hasAppliedRule: true }), doc("2", { hasAppliedRule: true }), doc("3", { hasAppliedRule: false })]
    const result = automationRateCheck.run(baseCtx(documents))
    const payload = result.findings[0].suggestedActionPayload as { automatedCount: number; manualCount: number; totalCount: number; rate: number }
    expect(payload.automatedCount).toBe(2)
    expect(payload.manualCount).toBe(1)
    expect(payload.totalCount).toBe(3)
    expect(payload.rate).toBeCloseTo((2 / 3) * 100)
  })

  it("excludes documents received outside the current window", () => {
    const outOfWindow = doc("1", { hasAppliedRule: true, receivedAt: new Date(from.getTime() - 1000) })
    const result = automationRateCheck.run(baseCtx([outOfWindow]))
    const payload = result.findings[0].suggestedActionPayload as { totalCount: number }
    expect(payload.totalCount).toBe(0)
  })
})
