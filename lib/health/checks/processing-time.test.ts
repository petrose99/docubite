import { describe, expect, it } from "vitest"
import { formatDurationMs, processingTimeCheck } from "@/lib/health/checks/processing-time"
import type { CheckContext, CheckDocumentSlice, CheckPushSlice } from "@/lib/health/types"

const to = new Date("2026-09-02T00:00:00.000Z")
const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
const receivedAt = new Date(from.getTime() + 1000)

function doc(id: string, overrides: Partial<CheckDocumentSlice> = {}): CheckDocumentSlice {
  return {
    id, fileId: `f${id}`, filename: `doc-${id}.pdf`, templateCode: "invoice", status: "extracted",
    receivedAt, supplierValue: null, supplierConfidence: null, hasPush: false, hasRejectedReviewTask: false,
    ...overrides,
  }
}

function baseCtx(documents: CheckDocumentSlice[], pushHistory: CheckPushSlice[] = []): CheckContext {
  return {
    workspaceId: "ws1", dateRange: { from, to }, ledger: null,
    documents, reviewTasks: [], pushHistory, automationRules: [], checkResults: [],
    confidenceDrift: [], lowConfidenceFields: [], bankStatements: [],
  }
}

describe("processingTimeCheck", () => {
  it("is always applicable and reports no sample when nothing has completed", () => {
    const result = processingTimeCheck.run(baseCtx([doc("1")]))
    expect(result.applicableCount).toBe(1)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].title).toBe("No completed documents this period")
    const payload = result.findings[0].suggestedActionPayload as { sampleSize: number }
    expect(payload.sampleSize).toBe(0)
  })

  it("measures duration from receivedAt to reviewedAt", () => {
    const reviewedAt = new Date(receivedAt.getTime() + 2 * 60 * 60 * 1000)
    const result = processingTimeCheck.run(baseCtx([doc("1", { reviewedAt })]))
    const payload = result.findings[0].suggestedActionPayload as { meanMs: number; medianMs: number; sampleSize: number }
    expect(payload.sampleSize).toBe(1)
    expect(payload.meanMs).toBe(2 * 60 * 60 * 1000)
    expect(payload.medianMs).toBe(2 * 60 * 60 * 1000)
  })

  it("falls back to the succeeded push timestamp when there was no review", () => {
    const completedAt = new Date(receivedAt.getTime() + 60 * 60 * 1000)
    const pushHistory: CheckPushSlice[] = [{ id: "p1", documentId: "1", status: "succeeded", attempts: 1, errorCode: null, updatedAt: completedAt }]
    const result = processingTimeCheck.run(baseCtx([doc("1")], pushHistory))
    const payload = result.findings[0].suggestedActionPayload as { sampleSize: number }
    expect(payload.sampleSize).toBe(1)
  })

  it("computes mean and median over a mixed sample", () => {
    const documents = [
      doc("1", { reviewedAt: new Date(receivedAt.getTime() + 1 * 60 * 60 * 1000) }),
      doc("2", { reviewedAt: new Date(receivedAt.getTime() + 3 * 60 * 60 * 1000) }),
      doc("3", { reviewedAt: new Date(receivedAt.getTime() + 5 * 60 * 60 * 1000) }),
    ]
    const result = processingTimeCheck.run(baseCtx(documents))
    const payload = result.findings[0].suggestedActionPayload as { meanMs: number; medianMs: number; sampleSize: number }
    expect(payload.sampleSize).toBe(3)
    expect(payload.medianMs).toBe(3 * 60 * 60 * 1000)
    expect(payload.meanMs).toBe(3 * 60 * 60 * 1000)
  })

  it("ignores documents still mid-pipeline (no reviewedAt, no succeeded push)", () => {
    const documents = [doc("1"), doc("2", { reviewedAt: new Date(receivedAt.getTime() + 1000) })]
    const result = processingTimeCheck.run(baseCtx(documents))
    const payload = result.findings[0].suggestedActionPayload as { sampleSize: number }
    expect(payload.sampleSize).toBe(1)
  })
})

describe("formatDurationMs", () => {
  it("formats under an hour as minutes", () => {
    expect(formatDurationMs(30 * 60 * 1000)).toBe("30m")
  })

  it("formats under 48 hours as hours", () => {
    expect(formatDurationMs(5 * 60 * 60 * 1000)).toBe("5.0h")
  })

  it("formats 48 hours or more as days", () => {
    expect(formatDurationMs(3 * 24 * 60 * 60 * 1000)).toBe("3.0d")
  })
})
