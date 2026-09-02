import { beforeEach, describe, expect, it, vi } from "vitest"

const mockCreateMany = vi.fn()
const mockFindMany = vi.fn()
const mockQueryRaw = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    documentSheetPlacement: { createMany: (...args: unknown[]) => mockCreateMany(...args), findMany: (...args: unknown[]) => mockFindMany(...args) },
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}))

const { createPlacements, listPlacedDocumentIds, countReviewedUnplaced } = await import("@/models/document-sheet-placements")

beforeEach(() => { vi.clearAllMocks() })

describe("createPlacements", () => {
  it("does nothing for empty array", async () => {
    const result = await createPlacements("ws1", "f1", "s1", [], "u1")
    expect(result).toEqual([])
    expect(mockCreateMany).not.toHaveBeenCalled()
  })

  it("creates placements with skipDuplicates", async () => {
    mockCreateMany.mockResolvedValue({ count: 2 })
    const ids = await createPlacements("ws1", "f1", "s1", ["d1", "d2"], "u1")
    expect(ids).toHaveLength(2)
    expect(mockCreateMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }))
    const call = mockCreateMany.mock.calls[0][0]
    expect(call.data).toHaveLength(2)
    expect(call.data[0].documentId).toBe("d1")
    expect(call.data[1].documentId).toBe("d2")
  })
})

describe("listPlacedDocumentIds", () => {
  it("returns distinct document ids", async () => {
    mockFindMany.mockResolvedValue([{ documentId: "d1" }, { documentId: "d2" }])
    const result = await listPlacedDocumentIds("f1")
    expect(result).toEqual(["d1", "d2"])
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { fileId: "f1" }, distinct: ["documentId"] }))
  })
})

describe("countReviewedUnplaced", () => {
  it("returns count from raw query", async () => {
    mockQueryRaw.mockResolvedValue([{ count: 5n }])
    const result = await countReviewedUnplaced("ws1")
    expect(result).toBe(5)
  })
})
