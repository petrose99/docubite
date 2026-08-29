import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/lib/ingestion", () => ({ createIngestionItem: vi.fn() }))
vi.mock("@/models/files", () => ({ createFile: vi.fn(), getFileTemplates: vi.fn() }))
vi.mock("@/models/workspaces", () => ({ getWorkspaceMembers: vi.fn() }))

const { addAllowedSender, ensureInboundEmailToken, isSenderAllowed, matchesAllowPattern, processInboundEmail, removeAllowedSender } = await import("@/models/inbound-email")
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
  db.inboundEmailAllowedSender = { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn(), findFirst: vi.fn(), delete: vi.fn() }
  db.documentAuditEvent = { create: vi.fn() }
  db.$transaction = vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[]))
})

describe("ensureInboundEmailToken", () => {
  it("refuses a clinical workspace outright", async () => {
    db.workspace = { findUniqueOrThrow: vi.fn().mockResolvedValue({ inboundEmailToken: null, industry: "healthcare" }) }
    await expect(ensureInboundEmailToken("w1")).rejects.toThrow("inbound_email_disabled_for_clinical")
  })

  it("returns the existing token without generating a new one", async () => {
    db.workspace = { findUniqueOrThrow: vi.fn().mockResolvedValue({ inboundEmailToken: "existing-token", industry: "finance" }), update: vi.fn() }
    const token = await ensureInboundEmailToken("w1")
    expect(token).toBe("existing-token")
    expect(db.workspace.update).not.toHaveBeenCalled()
  })

  it("generates and persists a token when none exists", async () => {
    db.workspace = { findUniqueOrThrow: vi.fn().mockResolvedValue({ inboundEmailToken: null, industry: "finance" }), update: vi.fn() }
    const token = await ensureInboundEmailToken("w1")
    expect(token).toEqual(expect.any(String))
    expect(token.length).toBeGreaterThan(10)
    expect(db.workspace.update).toHaveBeenCalledWith({ where: { id: "w1" }, data: { inboundEmailToken: token } })
  })
})

describe("matchesAllowPattern", () => {
  it("matches an exact email, case-insensitively", () => {
    expect(matchesAllowPattern("Bookkeeper@Firm.com", "bookkeeper@firm.com")).toBe(true)
    expect(matchesAllowPattern("bookkeeper@firm.com", "other@firm.com")).toBe(false)
  })

  it("matches a domain pattern only against the exact domain, not a subdomain", () => {
    expect(matchesAllowPattern("@corp.com", "x@corp.com")).toBe(true)
    expect(matchesAllowPattern("@corp.com", "x@sub.corp.com")).toBe(false)
  })
})

describe("isSenderAllowed", () => {
  beforeEach(() => { db.inboundEmailAllowedSender = { findMany: vi.fn().mockResolvedValue([]) } })

  it("allows a workspace member's address, case-insensitively", async () => {
    vi.mocked(getWorkspaceMembers).mockResolvedValue([{ user: { email: "Owner@Example.com" } }] as never)
    expect(await isSenderAllowed("w1", "owner@example.com")).toBe(true)
  })

  it("refuses a non-member, non-allowlisted address", async () => {
    vi.mocked(getWorkspaceMembers).mockResolvedValue([{ user: { email: "owner@example.com" } }] as never)
    expect(await isSenderAllowed("w1", "stranger@example.com")).toBe(false)
  })

  it("allows an address matching an allowlist entry", async () => {
    vi.mocked(getWorkspaceMembers).mockResolvedValue([])
    db.inboundEmailAllowedSender.findMany.mockResolvedValue([{ pattern: "@bookkeepers.com" }])
    expect(await isSenderAllowed("w1", "anyone@bookkeepers.com")).toBe(true)
  })

  it("refuses a blank address", async () => {
    expect(await isSenderAllowed("w1", "   ")).toBe(false)
  })
})

describe("addAllowedSender", () => {
  it("rejects an empty pattern", async () => {
    await expect(addAllowedSender({ workspaceId: "w1", pattern: "  ", createdById: "u1" })).rejects.toThrow("pattern_required")
  })

  it("rejects a pattern that is neither an email nor an @domain", async () => {
    await expect(addAllowedSender({ workspaceId: "w1", pattern: "not-valid", createdById: "u1" })).rejects.toThrow("pattern_invalid")
  })

  it("upserts a lowercased pattern and writes an audit event", async () => {
    db.inboundEmailAllowedSender.upsert.mockResolvedValue({ id: "s1", pattern: "bookkeeper@firm.com" })
    const row = await addAllowedSender({ workspaceId: "w1", pattern: "Bookkeeper@Firm.com", createdById: "u1" })
    expect(row).toEqual({ id: "s1", pattern: "bookkeeper@firm.com" })
    expect(db.inboundEmailAllowedSender.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId_pattern: { workspaceId: "w1", pattern: "bookkeeper@firm.com" } },
    }))
    expect(db.documentAuditEvent.create).toHaveBeenCalled()
  })

  it("accepts a domain pattern", async () => {
    db.inboundEmailAllowedSender.upsert.mockResolvedValue({ id: "s1", pattern: "@firm.com" })
    await expect(addAllowedSender({ workspaceId: "w1", pattern: "@firm.com", createdById: "u1" })).resolves.toBeTruthy()
  })
})

describe("removeAllowedSender", () => {
  it("throws when the sender does not belong to this workspace", async () => {
    db.inboundEmailAllowedSender.findFirst.mockResolvedValue(null)
    await expect(removeAllowedSender({ workspaceId: "w1", id: "s1", actorId: "u1" })).rejects.toThrow("allowed_sender_not_found")
  })

  it("deletes the row and writes an audit event", async () => {
    db.inboundEmailAllowedSender.findFirst.mockResolvedValue({ id: "s1", pattern: "x@firm.com" })
    await removeAllowedSender({ workspaceId: "w1", id: "s1", actorId: "u1" })
    expect(db.inboundEmailAllowedSender.delete).toHaveBeenCalledWith({ where: { id: "s1" } })
    expect(db.documentAuditEvent.create).toHaveBeenCalled()
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
