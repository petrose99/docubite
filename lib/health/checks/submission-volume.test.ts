import { describe, expect, it } from "vitest"
import { submissionVolumeCheck } from "@/lib/health/checks/submission-volume"
import type { CheckContext, CheckDocumentSlice } from "@/lib/health/types"

const to = new Date("2026-09-02T00:00:00.000Z")
const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
const priorFrom = new Date(from.getTime() - 30 * 24 * 60 * 60 * 1000)

function doc(id: string, receivedAt: Date): CheckDocumentSlice {
  return {
    id, fileId: `f${id}`, filename: `doc-${id}.pdf`, templateCode: "invoice", status: "extracted",
    receivedAt, supplierValue: null, supplierConfidence: null, hasPush: false, hasRejectedReviewTask: false,
  }
}

function baseCtx(documents: CheckDocumentSlice[]): CheckContext {
  return {
    workspaceId: "ws1", dateRange: { from, to }, ledger: null,
    documents, reviewTasks: [], pushHistory: [], automationRules: [], checkResults: [],
    confidenceDrift: [], lowConfidenceFields: [], bankStatements: [],
  }
}

describe("submissionVolumeCheck", () => {
  it("is always applicable and produces exactly one informational finding", () => {
    const result = submissionVolumeCheck.run(baseCtx([]))
    expect(result.applicableCount).toBe(1)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].severity).toBe("info")
  })

  it("counts documents received in the current window vs the prior window", () => {
    const documents = [
      doc("1", new Date(from.getTime() + 1000)),
      doc("2", new Date(from.getTime() + 2000)),
      doc("3", new Date(priorFrom.getTime() + 1000)),
    ]
    const result = submissionVolumeCheck.run(baseCtx(documents))
    const payload = result.findings[0].suggestedActionPayload as { currentCount: number; priorCount: number; delta: number }
    expect(payload.currentCount).toBe(2)
    expect(payload.priorCount).toBe(1)
    expect(payload.delta).toBe(1)
  })

  it("reports no comparison when the prior period is empty", () => {
    const result = submissionVolumeCheck.run(baseCtx([doc("1", new Date(from.getTime() + 1000))]))
    const payload = result.findings[0].suggestedActionPayload as { percentChange: number | null }
    expect(payload.percentChange).toBeNull()
    expect(result.findings[0].description).toContain("no submissions in the prior 30 days")
  })

  it("excludes documents outside both windows", () => {
    const documents = [doc("1", new Date(to.getTime() + 24 * 60 * 60 * 1000)), doc("2", new Date(priorFrom.getTime() - 1000))]
    const result = submissionVolumeCheck.run(baseCtx(documents))
    const payload = result.findings[0].suggestedActionPayload as { currentCount: number; priorCount: number }
    expect(payload.currentCount).toBe(0)
    expect(payload.priorCount).toBe(0)
  })
})
