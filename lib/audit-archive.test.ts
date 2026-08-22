import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/document-storage", () => ({ putDocumentSource: vi.fn() }))
vi.mock("@/lib/db", () => ({
  prisma: {
    documentAuditEvent: { findMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({
      $executeRaw: vi.fn(),
      documentAuditEvent: { deleteMany: vi.fn() },
    })),
  },
}))

const { archiveWorkspaceAuditEvents } = await import("@/lib/audit-archive")
const { putDocumentSource } = await import("@/lib/document-storage")
const { prisma } = await import("@/lib/db")

describe("archiveWorkspaceAuditEvents", () => {
  beforeEach(() => {
    vi.mocked(putDocumentSource).mockClear()
    vi.mocked(prisma.documentAuditEvent.findMany).mockReset()
  })

  it("writes an archive object and clears the rows when events exist", async () => {
    vi.mocked(prisma.documentAuditEvent.findMany).mockResolvedValue([{ id: "e1", type: "document_viewed" }] as never)

    const result = await archiveWorkspaceAuditEvents("w1")

    expect(result).toEqual({ archived: 1 })
    expect(putDocumentSource).toHaveBeenCalledTimes(1)
    const [key, body, contentType] = vi.mocked(putDocumentSource).mock.calls[0]
    expect(key).toMatch(/^audit-archives\/w1\//)
    expect(contentType).toBe("application/json")
    expect(JSON.parse(body.toString())).toMatchObject({ workspaceId: "w1", events: [{ id: "e1", type: "document_viewed" }] })
  })

  it("skips the archive write but still clears when there are no events", async () => {
    vi.mocked(prisma.documentAuditEvent.findMany).mockResolvedValue([])

    const result = await archiveWorkspaceAuditEvents("w1")

    expect(result).toEqual({ archived: 0 })
    expect(putDocumentSource).not.toHaveBeenCalled()
  })
})
