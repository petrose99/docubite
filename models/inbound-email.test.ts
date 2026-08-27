import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/lib/ingestion", () => ({ createIngestionItem: vi.fn() }))
vi.mock("@/models/files", () => ({ createFile: vi.fn(), getFileTemplates: vi.fn() }))
vi.mock("@/models/workspaces", () => ({ getWorkspaceMembers: vi.fn() }))

const { ensureInboundEmailToken, isSenderAllowed, processInboundEmail } = await import("@/models/inbound-email")
const { prisma } = await import("@/lib/db")
const { createIngestionItem } = await import("@/lib/ingestion")
const { createFile, getFileTemplates } = await import("@/models/files")
const { getWorkspaceMembers } = await import("@/models/workspaces")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

const PDF_BASE64 = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(16, 0x20)]).toString("base64")

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(db)) delete db[key]
})

describe("ensureInboundEmailToken", () => {
  it("refuses a clinical workspace outright", async () => {
    db.workspace = { findUniqueOrThrow: vi.fn().mockResolvedValue({ inboundEmailToken: null, productMode: "clinical" }) }
    await expect(ensureInboundEmailToken("w1")).rejects.toThrow("inbound_email_disabled_for_clinical")
  })

  it("returns the existing token without generating a new one", async () => {
    db.workspace = { findUniqueOrThrow: vi.fn().mockResolvedValue({ inboundEmailToken: "existing-token", productMode: "accounting" }), update: vi.fn() }
    const token = await ensureInboundEmailToken("w1")
    expect(token).toBe("existing-token")
    expect(db.workspace.update).not.toHaveBeenCalled()
  })

  it("generates and persists a token when none exists", async () => {
    db.workspace = { findUniqueOrThrow: vi.fn().mockResolvedValue({ inboundEmailToken: null, productMode: "accounting" }), update: vi.fn() }
    const token = await ensureInboundEmailToken("w1")
    expect(token).toEqual(expect.any(String))
    expect(token.length).toBeGreaterThan(10)
    expect(db.workspace.update).toHaveBeenCalledWith({ where: { id: "w1" }, data: { inboundEmailToken: token } })
  })
})

describe("isSenderAllowed", () => {
  it("allows a workspace member's address, case-insensitively", async () => {
    vi.mocked(getWorkspaceMembers).mockResolvedValue([{ user: { email: "Owner@Example.com" } }] as never)
    expect(await isSenderAllowed("w1", "owner@example.com")).toBe(true)
  })

  it("refuses a non-member address", async () => {
    vi.mocked(getWorkspaceMembers).mockResolvedValue([{ user: { email: "owner@example.com" } }] as never)
    expect(await isSenderAllowed("w1", "stranger@example.com")).toBe(false)
  })

  it("refuses a blank address", async () => {
    expect(await isSenderAllowed("w1", "   ")).toBe(false)
  })
})

describe("processInboundEmail", () => {
  const attachment = { filename: "invoice.pdf", contentType: "application/pdf", base64Content: PDF_BASE64 }

  beforeEach(() => {
    vi.mocked(getWorkspaceMembers).mockResolvedValue([{ user: { email: "owner@example.com" } }] as never)
    db.documentFile = { findFirst: vi.fn().mockResolvedValue({ id: "f1" }) }
    vi.mocked(getFileTemplates).mockResolvedValue([{ id: "t1", code: "generic" }] as never)
  })

  it("refuses a sender who is not a workspace member, before touching any file", async () => {
    await expect(processInboundEmail({ workspaceId: "w1", from: "stranger@example.com", attachments: [attachment] })).rejects.toThrow("sender_not_allowed")
    expect(db.documentFile.findFirst).not.toHaveBeenCalled()
  })

  it("reuses the existing email intake file rather than creating a second one", async () => {
    vi.mocked(createIngestionItem).mockResolvedValue({ outcome: "accepted" } as never)
    await processInboundEmail({ workspaceId: "w1", from: "owner@example.com", attachments: [attachment] })
    expect(createFile).not.toHaveBeenCalled()
  })

  it("creates the email intake file on first use, owned by the workspace's earliest owner", async () => {
    db.documentFile = { findFirst: vi.fn().mockResolvedValue(null) }
    db.workspaceMember = { findFirst: vi.fn().mockResolvedValue({ userId: "owner-1" }) }
    vi.mocked(createFile).mockResolvedValue({ id: "f2" } as never)
    vi.mocked(createIngestionItem).mockResolvedValue({ outcome: "accepted" } as never)

    await processInboundEmail({ workspaceId: "w1", from: "owner@example.com", attachments: [attachment] })

    expect(createFile).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "w1", userId: "owner-1", name: "Email intake" }))
  })

  it("rejects an attachment whose content doesn't match its claimed type", async () => {
    const fake = { filename: "invoice.pdf", contentType: "application/pdf", base64Content: Buffer.from("not a pdf").toString("base64") }
    const result = await processInboundEmail({ workspaceId: "w1", from: "owner@example.com", attachments: [fake] })
    expect(result).toEqual({ accepted: 0, rejected: 1 })
    expect(createIngestionItem).not.toHaveBeenCalled()
  })

  it("rejects an attachment with an unrecognised extension", async () => {
    const unknown = { filename: "notes.txt", contentType: "text/plain", base64Content: Buffer.from("hello").toString("base64") }
    const result = await processInboundEmail({ workspaceId: "w1", from: "owner@example.com", attachments: [unknown] })
    expect(result).toEqual({ accepted: 0, rejected: 1 })
  })

  it("counts an accepted and a duplicate outcome as accepted, and a rejected outcome as rejected", async () => {
    vi.mocked(createIngestionItem)
      .mockResolvedValueOnce({ outcome: "accepted" } as never)
      .mockResolvedValueOnce({ outcome: "duplicate" } as never)
      .mockResolvedValueOnce({ outcome: "rejected" } as never)

    const result = await processInboundEmail({ workspaceId: "w1", from: "owner@example.com", attachments: [attachment, attachment, attachment] })

    expect(result).toEqual({ accepted: 2, rejected: 1 })
  })

  it("tags every ingested attachment with source \"email\"", async () => {
    vi.mocked(createIngestionItem).mockResolvedValue({ outcome: "accepted" } as never)
    await processInboundEmail({ workspaceId: "w1", from: "owner@example.com", attachments: [attachment] })
    expect(vi.mocked(createIngestionItem).mock.calls[0][0].source).toBe("email")
  })
})
