import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))

const { track, sweepOldProductEvents, PRODUCT_EVENT_RETENTION_DAYS } = await import("@/lib/analytics")
const { prisma } = await import("@/lib/db")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  db.productEvent = { create: vi.fn(), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) }
})

describe("track", () => {
  it("writes a valid event with its workspace and actor", async () => {
    await track("document_correction_saved", { documentId: "11111111-1111-1111-1111-111111111111", fieldCount: 3 }, { workspaceId: "w1", actorId: "u1" })
    expect(db.productEvent.create).toHaveBeenCalledWith({
      data: { workspaceId: "w1", actorId: "u1", name: "document_correction_saved", props: { documentId: "11111111-1111-1111-1111-111111111111", fieldCount: 3 } },
    })
  })

  it("defaults workspaceId/actorId to null when no context is given", async () => {
    await track("document_exported", { fileId: "11111111-1111-1111-1111-111111111111", format: "csv" })
    expect(db.productEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ workspaceId: null, actorId: null }) }))
  })

  it("drops an event carrying an unexpected key rather than silently accepting it", async () => {
    await track("document_exported", { fileId: "11111111-1111-1111-1111-111111111111", format: "csv", filename: "invoice.pdf" } as never)
    expect(db.productEvent.create).not.toHaveBeenCalled()
  })

  it("drops an event with a PII-shaped free-text field", async () => {
    await track("document_correction_saved", { documentId: "11111111-1111-1111-1111-111111111111", fieldCount: 3, note: "john@example.com" } as never)
    expect(db.productEvent.create).not.toHaveBeenCalled()
  })

  it("never throws when the database write fails", async () => {
    db.productEvent.create.mockRejectedValue(new Error("boom"))
    await expect(track("document_exported", { fileId: "11111111-1111-1111-1111-111111111111", format: "csv" })).resolves.toBeUndefined()
  })
})

describe("sweepOldProductEvents", () => {
  it("deletes rows older than the retention window", async () => {
    const now = new Date("2026-06-01T00:00:00Z")
    await sweepOldProductEvents(now)
    const cutoff = db.productEvent.deleteMany.mock.calls[0][0].where.createdAt.lt as Date
    expect(now.getTime() - cutoff.getTime()).toBe(PRODUCT_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  })
})
