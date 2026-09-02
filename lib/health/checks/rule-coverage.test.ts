import { describe, expect, it } from "vitest"
import type { AutomationRuleInput } from "@/lib/automation/rules"
import { ruleCoverageCheck } from "@/lib/health/checks/rule-coverage"
import type { CheckContext, CheckDocumentSlice } from "@/lib/health/types"

const now = new Date("2026-09-02T00:00:00.000Z")
const from = new Date("2026-08-03T00:00:00.000Z")

function doc(overrides: Partial<CheckDocumentSlice> = {}): CheckDocumentSlice {
  return { id: "d1", fileId: "f1", filename: "a.pdf", templateCode: "invoice", status: "extracted", receivedAt: now, supplierValue: "Acme Ltd", supplierConfidence: 0.9, hasPush: false, hasRejectedReviewTask: false, ...overrides }
}

function baseCtx(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    workspaceId: "ws1", dateRange: { from, to: now }, ledger: null,
    documents: [], reviewTasks: [], pushHistory: [], automationRules: [], checkResults: [],
    confidenceDrift: [], lowConfidenceFields: [], bankStatements: [],
    ...overrides,
  }
}

describe("ruleCoverageCheck", () => {
  it("is not applicable with no eligible documents", () => {
    const result = ruleCoverageCheck.run(baseCtx())
    expect(result.applicableCount).toBe(0)
    expect(result.findings).toHaveLength(0)
  })

  it("skips a document outside the date range", () => {
    const result = ruleCoverageCheck.run(baseCtx({ documents: [doc({ receivedAt: new Date("2026-01-01T00:00:00.000Z") })] }))
    expect(result.applicableCount).toBe(0)
  })

  it("skips a template with no supplier concept", () => {
    const result = ruleCoverageCheck.run(baseCtx({ documents: [doc({ templateCode: "bank_statement" })] }))
    expect(result.applicableCount).toBe(0)
  })

  it("does not flag a vendor under 3 unmatched documents", () => {
    const docs = [doc({ id: "1" }), doc({ id: "2" })]
    const result = ruleCoverageCheck.run(baseCtx({ documents: docs }))
    expect(result.applicableCount).toBe(2)
    expect(result.findings).toHaveLength(0)
  })

  it("flags a vendor with 3+ documents matching no active rule", () => {
    const docs = [doc({ id: "1" }), doc({ id: "2" }), doc({ id: "3" })]
    const result = ruleCoverageCheck.run(baseCtx({ documents: docs }))
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].affectedCount).toBe(3)
  })

  it("does not flag a vendor an active rule already codes", () => {
    const docs = [doc({ id: "1" }), doc({ id: "2" }), doc({ id: "3" })]
    const rules: AutomationRuleInput[] = [{
      id: "r1", matcher: { type: "contains", value: "acme" }, actions: { codingData: { account: "6000" } },
      minConfidence: null, requireReview: false, isActive: true, createdAt: now,
    }]
    const result = ruleCoverageCheck.run(baseCtx({ documents: docs, automationRules: rules }))
    expect(result.findings).toHaveLength(0)
  })
})
