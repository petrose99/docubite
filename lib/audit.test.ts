import { describe, expect, it, vi } from "vitest"

// next/headers throws outside a request scope in the real runtime (the job worker, scripts) —
// mocked here to do the same, so getRequestAuditContext's fallback path is exercised rather than
// a test-environment accident of next/headers just returning undefined.
vi.mock("next/headers", () => ({
  headers: vi.fn(() => { throw new Error("no request scope") }),
}))
vi.mock("@/lib/db", () => ({ prisma: { documentAuditEvent: { create: vi.fn() } } }))

const { auditEventData, getRequestAuditContext, recordDocumentAudit, recordSystemAudit } = await import("@/lib/audit")
const { prisma } = await import("@/lib/db")

describe("getRequestAuditContext", () => {
  it("returns all-null when there is no request scope, rather than throwing", async () => {
    await expect(getRequestAuditContext()).resolves.toEqual({ sourceIp: null, userAgent: null })
  })
})

describe("auditEventData", () => {
  it("defaults outcome to success and passes through the given context", () => {
    const data = auditEventData({ workspaceId: "w1", type: "document_viewed" }, { sourceIp: "1.2.3.4", userAgent: "curl" })
    expect(data).toEqual({
      workspaceId: "w1", documentId: null, actorId: null, type: "document_viewed",
      outcome: "success", detail: undefined, sourceIp: "1.2.3.4", userAgent: "curl",
    })
  })
})

describe("recordDocumentAudit", () => {
  it("writes with null sourceIp/userAgent when headers() throws", async () => {
    vi.mocked(prisma.documentAuditEvent.create).mockClear()
    await recordDocumentAudit({ workspaceId: "w1", type: "document_viewed", actorId: "u1" })
    expect(prisma.documentAuditEvent.create).toHaveBeenCalledWith({
      data: { workspaceId: "w1", documentId: null, actorId: "u1", type: "document_viewed", outcome: "success", detail: undefined, sourceIp: null, userAgent: null },
    })
  })

  it("never throws when the write itself fails — an audit failure must not break the caller", async () => {
    vi.mocked(prisma.documentAuditEvent.create).mockRejectedValueOnce(new Error("db down"))
    await expect(recordDocumentAudit({ workspaceId: "w1", type: "document_viewed" })).resolves.toBeUndefined()
  })
})

describe("recordSystemAudit", () => {
  it("always writes a null actorId and never calls headers()", async () => {
    vi.mocked(prisma.documentAuditEvent.create).mockClear()
    await recordSystemAudit({ workspaceId: "w1", documentId: "d1", type: "extraction_completed" })
    expect(prisma.documentAuditEvent.create).toHaveBeenCalledWith({
      data: { workspaceId: "w1", documentId: "d1", actorId: null, type: "extraction_completed", outcome: "success", detail: undefined, sourceIp: null, userAgent: null },
    })
  })
})
