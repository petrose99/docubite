import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/prisma/client", () => ({ Prisma: {}, PrismaClient: vi.fn() }))
vi.mock("@/lib/audit", () => ({ auditEventData: vi.fn(), getRequestAuditContext: vi.fn().mockResolvedValue({ sourceIp: null, userAgent: null }) }))
vi.mock("@/lib/document-templates", () => ({ DEFAULT_DOCUMENT_TEMPLATES: [], parseTemplateFields: vi.fn() }))
vi.mock("@/lib/domains", () => ({ dictationAdapters: {} }))
vi.mock("@/lib/document-storage", () => ({
  deleteDocumentSource: vi.fn(), documentStorageKey: vi.fn(), putDocumentSource: vi.fn(), readDocumentSource: vi.fn(),
}))

const { getFileAccess, setLinkAccess } = await import("@/models/files")
const { prisma } = await import("@/lib/db")

// F15: hipaaMode locks a workspace's files out of link-based access entirely — no anonymous
// visitor, and no signed-in stranger, gets in through a bare URL. Only membership or an explicit
// per-email share may open the file.
describe("getFileAccess with hipaaMode", () => {
  beforeEach(() => {
    Object.assign(prisma, {
      documentFile: { findUnique: vi.fn() },
      workspaceMember: { findUnique: vi.fn() },
      documentFileShare: { findUnique: vi.fn(), update: vi.fn() },
    })
  })

  it("returns none for a signed-out viewer even though linkAccess is view", async () => {
    vi.mocked(prisma.documentFile.findUnique).mockResolvedValue({
      id: "f1", workspaceId: "w1", linkAccess: "view", workspace: { hipaaMode: true },
    } as never)

    const resolved = await getFileAccess("f1", null)

    expect(resolved).toEqual({ access: "none", file: expect.objectContaining({ id: "f1" }) })
  })

  it("returns none for a signed-in non-member with no explicit share", async () => {
    vi.mocked(prisma.documentFile.findUnique).mockResolvedValue({
      id: "f1", workspaceId: "w1", linkAccess: "edit", workspace: { hipaaMode: true },
    } as never)
    vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.documentFileShare.findUnique).mockResolvedValue(null)

    const resolved = await getFileAccess("f1", { id: "u1", email: "stranger@example.com" })

    expect(resolved?.access).toBe("none")
  })

  it("still honours an explicit per-email share under hipaaMode", async () => {
    vi.mocked(prisma.documentFile.findUnique).mockResolvedValue({
      id: "f1", workspaceId: "w1", linkAccess: "none", workspace: { hipaaMode: true },
    } as never)
    vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.documentFileShare.findUnique).mockResolvedValue({ id: "s1", access: "edit", userId: "u1" } as never)

    const resolved = await getFileAccess("f1", { id: "u1", email: "invited@example.com" })

    expect(resolved?.access).toBe("edit")
  })

  it("respects linkAccess as normal when hipaaMode is off", async () => {
    vi.mocked(prisma.documentFile.findUnique).mockResolvedValue({
      id: "f1", workspaceId: "w1", linkAccess: "view", workspace: { hipaaMode: false },
    } as never)

    const resolved = await getFileAccess("f1", null)

    expect(resolved?.access).toBe("view")
  })
})

describe("setLinkAccess with hipaaMode", () => {
  beforeEach(() => {
    Object.assign(prisma, {
      documentFile: { findFirst: vi.fn().mockResolvedValue({ id: "f1", workspaceId: "w1" }), update: vi.fn() },
      workspace: { findUnique: vi.fn() },
    })
  })

  it("refuses to open link sharing for a hipaaMode workspace", async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ hipaaMode: true } as never)
    await expect(setLinkAccess("w1", "f1", "view")).rejects.toThrow("link_sharing_disabled_hipaa_mode")
    expect(prisma.documentFile.update).not.toHaveBeenCalled()
  })

  it("still allows narrowing an existing link back to none under hipaaMode", async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ hipaaMode: true } as never)
    await setLinkAccess("w1", "f1", "none")
    expect(prisma.documentFile.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { linkAccess: "none" } })
  })

  it("does not even check the workspace when hipaaMode is off", async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ hipaaMode: false } as never)
    await setLinkAccess("w1", "f1", "edit")
    expect(prisma.documentFile.update).toHaveBeenCalledWith({ where: { id: "f1" }, data: { linkAccess: "edit" } })
  })
})
