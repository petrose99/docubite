import { describe, expect, it } from "vitest"
import { buildConfidenceDriftSql, confidenceDriftCheck } from "@/lib/health/checks/confidence-drift"
import type { CheckContext, ConfidenceDriftRow } from "@/lib/health/types"

describe("buildConfidenceDriftSql", () => {
  it("binds workspaceId and the 30/60-day window boundaries as parameters, not interpolated", () => {
    const to = new Date("2026-09-02T00:00:00.000Z")
    const sql = buildConfidenceDriftSql("ws1", to)
    expect(sql.params).toEqual(["ws1", new Date("2026-08-03T00:00:00.000Z"), to, new Date("2026-07-04T00:00:00.000Z")])
    expect(sql.text).toContain("$1::uuid")
    expect(sql.text).toContain('"source_confidence"')
    expect(sql.text).toContain("GROUP BY")
    expect(sql.text).not.toContain("ws1")
  })
})

const now = new Date("2026-09-02T00:00:00.000Z")

function baseCtx(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    workspaceId: "ws1", dateRange: { from: now, to: now }, ledger: null,
    documents: [], reviewTasks: [], pushHistory: [], automationRules: [], checkResults: [],
    confidenceDrift: [], lowConfidenceFields: [], bankStatements: [],
    ...overrides,
  }
}

function row(overrides: Partial<ConfidenceDriftRow> = {}): ConfidenceDriftRow {
  return { templateCode: "invoice", currentMean: 0.9, currentCount: 10, priorMean: 0.9, priorCount: 10, representativeDocumentId: "d1", ...overrides }
}

describe("confidenceDriftCheck", () => {
  it("skips a template with no prior-period baseline", () => {
    const result = confidenceDriftCheck.run(baseCtx({ confidenceDrift: [row({ priorCount: 0 })] }))
    expect(result.applicableCount).toBe(0)
    expect(result.findings).toHaveLength(0)
  })

  it("passes when confidence holds steady", () => {
    const result = confidenceDriftCheck.run(baseCtx({ confidenceDrift: [row()] }))
    expect(result.applicableCount).toBe(1)
    expect(result.findings).toHaveLength(0)
  })

  it("flags a drop of more than 5 points", () => {
    const result = confidenceDriftCheck.run(baseCtx({ confidenceDrift: [row({ priorMean: 0.9, currentMean: 0.8 })] }))
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].documentId).toBe("d1")
  })

  it("does not flag a drop under 5 points", () => {
    const result = confidenceDriftCheck.run(baseCtx({ confidenceDrift: [row({ priorMean: 0.9, currentMean: 0.86 })] }))
    expect(result.findings).toHaveLength(0)
  })
})
