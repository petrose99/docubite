import { describe, expect, it } from "vitest"
import { reviewBacklogCheck } from "@/lib/health/checks/review-backlog"
import type { CheckContext } from "@/lib/health/types"

const now = new Date("2026-09-02T00:00:00.000Z")

function baseCtx(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    workspaceId: "ws1",
    dateRange: { from: new Date("2026-08-03T00:00:00.000Z"), to: now },
    ledger: null,
    documents: [],
    reviewTasks: [],
    pushHistory: [],
    automationRules: [],
    checkResults: [],
    confidenceDrift: [],
    lowConfidenceFields: [], bankStatements: [],
    ...overrides,
  }
}

describe("reviewBacklogCheck", () => {
  it("passes with an empty or small backlog", () => {
    const result = reviewBacklogCheck.run(baseCtx({ reviewTasks: [{ id: "1", documentId: "d1", status: "open", createdAt: now }] }))
    expect(result.findings).toHaveLength(0)
    expect(result.applicableCount).toBe(1)
  })

  it("flags more than 20 open tasks", () => {
    const reviewTasks = Array.from({ length: 21 }, (_, i) => ({ id: `${i}`, documentId: `d${i}`, status: "open" as const, createdAt: now }))
    const result = reviewBacklogCheck.run(baseCtx({ reviewTasks }))
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].affectedCount).toBe(21)
  })

  it("flags a single task older than 7 days even under the count threshold", () => {
    const old = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000)
    const result = reviewBacklogCheck.run(baseCtx({ reviewTasks: [{ id: "1", documentId: "d1", status: "in_review", createdAt: old }] }))
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].description).toContain("8 days")
  })

  it("ignores resolved tasks entirely", () => {
    const old = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const result = reviewBacklogCheck.run(baseCtx({ reviewTasks: [{ id: "1", documentId: "d1", status: "approved", createdAt: old }] }))
    expect(result.findings).toHaveLength(0)
  })
})
