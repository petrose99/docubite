import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))

const { getInboxSummary, findSupplierDocuments, getDocumentDetails, getSupplierRules } = await import("@/lib/finance/inbox")
const { prisma } = await import("@/lib/db")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(db)) delete db[key]
})

describe("getInboxSummary", () => {
  it("fills every review-task status, defaulting to 0 for ones with no rows", async () => {
    db.reviewTask = { groupBy: vi.fn().mockResolvedValue([{ status: "open", _count: { _all: 3 } }]) }
    db.documentCheckResult = { count: vi.fn().mockResolvedValue(2) }
    db.document = { count: vi.fn().mockResolvedValue(5) }

    const result = await getInboxSummary("w1")
    expect(result.reviewTasksByStatus).toEqual({ open: 3, in_review: 0, approved: 0, rejected: 0 })
    expect(result.documentsWithFailingChecks).toBe(2)
    expect(result.documentsWithNoRuleApplied).toBe(5)
  })
})

describe("findSupplierDocuments", () => {
  it("returns nothing for a blank query without touching the database", async () => {
    db.document = { findMany: vi.fn() }
    expect(await findSupplierDocuments("w1", "   ")).toEqual([])
    expect(db.document.findMany).not.toHaveBeenCalled()
  })

  it("matches on reviewedData first, falling back to rawExtraction", async () => {
    db.document = {
      findMany: vi.fn().mockResolvedValue([
        { id: "d1", filename: "a.pdf", status: "reviewed", receivedAt: new Date("2026-01-01"), reviewedData: { vendor: "Acme Corp", total: 100 }, rawExtraction: null },
        { id: "d2", filename: "b.pdf", status: "extracted", receivedAt: new Date("2026-01-02"), reviewedData: null, rawExtraction: { merchant: "acme diner", total: 12 } },
        { id: "d3", filename: "c.pdf", status: "reviewed", receivedAt: new Date("2026-01-03"), reviewedData: { vendor: "Other Co" }, rawExtraction: null },
      ]),
    }
    const results = await findSupplierDocuments("w1", "acme")
    expect(results.map((r) => r.documentId)).toEqual(["d1", "d2"])
  })
})

describe("getDocumentDetails", () => {
  it("returns null for a document not in this workspace", async () => {
    db.document = { findFirst: vi.fn().mockResolvedValue(null) }
    expect(await getDocumentDetails("w1", "d1")).toBeNull()
  })

  it("falls back to rawExtraction when reviewedData is null", async () => {
    db.document = {
      findFirst: vi.fn().mockResolvedValue({
        id: "d1", filename: "a.pdf", status: "extracted", reviewedData: null, rawExtraction: { vendor: "Acme" },
        confidence: { vendor: 0.9 }, codingData: null, appliedRule: null, checkResults: [], reviewTasks: [],
      }),
    }
    const details = await getDocumentDetails("w1", "d1")
    expect(details?.fields).toEqual({ vendor: "Acme" })
  })
})

describe("getSupplierRules", () => {
  it("lists only active rules, most-used first", async () => {
    db.automationRule = { findMany: vi.fn().mockResolvedValue([{ id: "r1", hitCount: 10 }]) }
    await getSupplierRules("w1")
    expect(db.automationRule.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId: "w1", isActive: true },
      orderBy: { hitCount: "desc" },
    }))
  })
})
