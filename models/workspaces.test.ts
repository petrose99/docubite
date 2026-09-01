import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/prisma/client", () => ({ Prisma: {}, PrismaClient: vi.fn() }))
vi.mock("@/models/files", () => ({ createFile: vi.fn(), deleteFiles: vi.fn() }))
vi.mock("@/lib/document-storage", () => ({ deleteDocumentSource: vi.fn() }))
vi.mock("@/lib/audit-archive", () => ({ archiveWorkspaceAuditEvents: vi.fn().mockResolvedValue({ archived: 0 }) }))

const {
  acceptWorkspaceInvitation,
  createTeamWorkspace,
  createWorkspaceInvitation,
  deleteWorkspace,
  getPendingInvitationForEmail,
  leaveWorkspace,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
  transferWorkspaceOwnership,
  updateWorkspaceMemberRole,
} = await import("@/models/workspaces")
const { prisma } = await import("@/lib/db")
const { deleteFiles, createFile } = await import("@/models/files")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(db)) delete db[key]
  db.$transaction = vi.fn(async (operations: unknown[]) => operations)
})

describe("createTeamWorkspace", () => {
  it("creates a team workspace with no plan/seat gate", async () => {
    db.workspace = { create: vi.fn().mockResolvedValue({ id: "w-new", industry: "finance" }) }
    vi.mocked(createFile).mockResolvedValue({ id: "f1" } as never)

    const workspace = await createTeamWorkspace({ id: "u1", name: "A", email: "a@example.com", role: "user" }, "Team")

    expect(workspace).toEqual({ id: "w-new", industry: "finance" })
    expect(db.workspace.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: "Team", kind: "team", industry: "finance" }),
    }))
  })
})

describe("createWorkspaceInvitation", () => {
  it("creates an invitation with no seat limit to check", async () => {
    db.workspaceMember = {
      findUnique: vi.fn().mockResolvedValue({ role: "owner", workspace: {} }),
      findFirst: vi.fn().mockResolvedValue(null),
    }
    db.workspace = { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "w1", name: "W" }) }
    db.user = { findUnique: vi.fn().mockResolvedValue({ email: "owner@example.com" }) }
    db.workspaceInvitation = { deleteMany: vi.fn(), create: vi.fn().mockResolvedValue({ id: "i1" }) }

    const result = await createWorkspaceInvitation({ workspaceId: "w1", ownerId: "u1", email: "b@example.com" })

    expect(result.workspaceName).toBe("W")
  })

  it("refuses inviting yourself", async () => {
    db.workspaceMember = { findUnique: vi.fn().mockResolvedValue({ role: "owner", workspace: {} }) }
    db.workspace = { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "w1", name: "W" }) }
    db.user = { findUnique: vi.fn().mockResolvedValue({ email: "owner@example.com" }) }
    await expect(createWorkspaceInvitation({ workspaceId: "w1", ownerId: "u1", email: "Owner@Example.com" })).rejects.toThrow("self_invite")
  })
})

describe("updateWorkspaceMemberRole", () => {
  it("refuses to demote the only owner", async () => {
    db.workspaceMember = {
      findUnique: vi.fn().mockResolvedValue({ id: "m1", role: "owner" }),
      count: vi.fn().mockResolvedValue(1),
      update: vi.fn(),
    }
    await expect(updateWorkspaceMemberRole({ workspaceId: "w1", actorId: "u2", memberUserId: "u1", role: "member" })).rejects.toThrow("last_owner_required")
    expect(db.workspaceMember.update).not.toHaveBeenCalled()
  })

  it("demotes an owner once a second owner exists", async () => {
    db.workspaceMember = {
      findUnique: vi.fn().mockResolvedValue({ id: "m1", role: "owner" }),
      count: vi.fn().mockResolvedValue(2),
      update: vi.fn().mockReturnValue({ id: "m1", role: "member" }),
    }
    db.documentAuditEvent = { create: vi.fn().mockReturnValue("audit") }

    await updateWorkspaceMemberRole({ workspaceId: "w1", actorId: "u2", memberUserId: "u1", role: "member" })

    expect(db.workspaceMember.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { role: "member" } })
    expect(db.$transaction).toHaveBeenCalledTimes(1)
  })

  it("rejects an unknown member", async () => {
    db.workspaceMember = { findUnique: vi.fn().mockResolvedValue(null), count: vi.fn(), update: vi.fn() }
    await expect(updateWorkspaceMemberRole({ workspaceId: "w1", actorId: "u2", memberUserId: "nobody", role: "owner" })).rejects.toThrow("member_not_found")
  })
})

describe("removeWorkspaceMember", () => {
  it("refuses to remove yourself", async () => {
    await expect(removeWorkspaceMember({ workspaceId: "w1", actorId: "u1", memberUserId: "u1" })).rejects.toThrow("use_leave_workspace")
  })

  it("refuses to remove the last owner", async () => {
    db.workspaceMember = {
      findUnique: vi.fn().mockResolvedValue({ id: "m1", role: "owner", user: { email: "a@example.com" } }),
      count: vi.fn().mockResolvedValue(1),
    }
    await expect(removeWorkspaceMember({ workspaceId: "w1", actorId: "u2", memberUserId: "u1" })).rejects.toThrow("last_owner_required")
  })

  it("revokes the removed member's per-email file shares in the same transaction", async () => {
    db.workspaceMember = {
      findUnique: vi.fn().mockResolvedValue({ id: "m1", role: "member", user: { email: "B@Example.com" } }),
      count: vi.fn().mockResolvedValue(2),
      delete: vi.fn().mockReturnValue("delete-member"),
    }
    db.documentFileShare = { deleteMany: vi.fn().mockReturnValue("delete-shares") }
    db.workspaceInvitation = { deleteMany: vi.fn().mockReturnValue("delete-invites") }
    db.documentAuditEvent = { create: vi.fn().mockReturnValue("audit") }

    await removeWorkspaceMember({ workspaceId: "w1", actorId: "u2", memberUserId: "u1" })

    expect(db.documentFileShare.deleteMany).toHaveBeenCalledWith({ where: { email: "b@example.com", file: { workspaceId: "w1" } } })
    expect(db.$transaction).toHaveBeenCalledWith(["delete-member", "delete-shares", "delete-invites", "audit"])
  })
})

describe("leaveWorkspace", () => {
  it("refuses a personal workspace", async () => {
    db.workspaceMember = { findUnique: vi.fn().mockResolvedValue({ id: "m1", role: "owner", user: { email: "a@example.com" }, workspace: { kind: "personal" } }) }
    await expect(leaveWorkspace("w1", "u1")).rejects.toThrow("cannot_leave_personal_workspace")
  })

  it("refuses a sole owner who still has team-mates", async () => {
    db.workspaceMember = {
      findUnique: vi.fn().mockResolvedValue({ id: "m1", role: "owner", user: { email: "a@example.com" }, workspace: { kind: "team" } }),
      count: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(3),
    }
    await expect(leaveWorkspace("w1", "u1")).rejects.toThrow("transfer_ownership_before_leaving")
  })

  it("tells a sole owner who is also the sole member to delete instead", async () => {
    db.workspaceMember = {
      findUnique: vi.fn().mockResolvedValue({ id: "m1", role: "owner", user: { email: "a@example.com" }, workspace: { kind: "team" } }),
      count: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1),
    }
    await expect(leaveWorkspace("w1", "u1")).rejects.toThrow("delete_workspace_instead")
  })
})

describe("transferWorkspaceOwnership", () => {
  it("promotes the target and demotes the actor in one transaction", async () => {
    db.workspaceMember = {
      findUnique: vi.fn().mockResolvedValue({ id: "m2", role: "member" }),
      update: vi.fn((args: unknown) => args),
    }
    db.documentAuditEvent = { create: vi.fn().mockReturnValue("audit") }

    await transferWorkspaceOwnership({ workspaceId: "w1", actorId: "u1", targetUserId: "u2" })

    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.$transaction.mock.calls[0][0]).toEqual([
      { where: { workspaceId_userId: { workspaceId: "w1", userId: "u2" } }, data: { role: "owner" } },
      { where: { workspaceId_userId: { workspaceId: "w1", userId: "u1" } }, data: { role: "member" } },
      "audit",
    ])
  })

  it("refuses transferring to yourself", async () => {
    await expect(transferWorkspaceOwnership({ workspaceId: "w1", actorId: "u1", targetUserId: "u1" })).rejects.toThrow("cannot_transfer_to_self")
  })
})

describe("deleteWorkspace", () => {
  const filePages = (total: number) => {
    let remaining = total
    return vi.fn(async () => {
      const size = Math.min(100, remaining)
      remaining -= size
      return Array.from({ length: size }, (_, index) => ({ id: `f${remaining}-${index}` }))
    })
  }

  it("pages through deleteFiles so blobs past the first 100 are not orphaned", async () => {
    db.documentFile = { findMany: filePages(250) }
    db.document = { findMany: vi.fn().mockResolvedValue([]) }
    db.workspace = { findUnique: vi.fn().mockResolvedValue({ name: "W", kind: "team" }), delete: vi.fn() }
    db.adminAuditEvent = { create: vi.fn() }
    vi.mocked(deleteFiles).mockImplementation(async (_workspaceId, ids) => ({ deleted: ids.length }))

    await deleteWorkspace({ workspaceId: "w1", actorId: "u1" })

    expect(deleteFiles).toHaveBeenCalledTimes(3)
    expect(vi.mocked(deleteFiles).mock.calls.map((call) => call[1].length)).toEqual([100, 100, 50])
    expect(db.workspace.delete).toHaveBeenCalledWith({ where: { id: "w1" } })
  })
})

describe("revokeWorkspaceInvitation", () => {
  it("scopes the delete by workspace as well as invitation id", async () => {
    db.workspaceInvitation = { findFirst: vi.fn().mockResolvedValue({ email: "b@example.com" }), deleteMany: vi.fn().mockResolvedValue({ count: 1 }) }
    db.documentAuditEvent = { create: vi.fn() }
    await revokeWorkspaceInvitation("w1", "i1", "u1")
    expect(db.workspaceInvitation.deleteMany).toHaveBeenCalledWith({ where: { id: "i1", workspaceId: "w1" } })
  })
})

describe("getPendingInvitationForEmail", () => {
  it("normalises the address and filters out accepted and expired rows", async () => {
    db.workspaceInvitation = { findFirst: vi.fn().mockResolvedValue({ id: "i1" }) }
    await getPendingInvitationForEmail("  Someone@Example.COM ")
    const where = db.workspaceInvitation.findFirst.mock.calls[0][0].where
    expect(where.email).toBe("someone@example.com")
    expect(where.acceptedAt).toBeNull()
    expect(where.expiresAt.gt).toBeInstanceOf(Date)
  })

  it("returns null for a blank address without querying", async () => {
    db.workspaceInvitation = { findFirst: vi.fn() }
    expect(await getPendingInvitationForEmail("   ")).toBeNull()
    expect(db.workspaceInvitation.findFirst).not.toHaveBeenCalled()
  })
})

describe("acceptWorkspaceInvitation", () => {
  const future = () => new Date(Date.now() + 60_000)
  const user = { id: "u1", email: "invitee@example.com" }

  it("rejects an expired invitation", async () => {
    db.workspaceInvitation = { findUnique: vi.fn().mockResolvedValue({ id: "i1", workspaceId: "w1", email: user.email, role: "member", acceptedAt: null, expiresAt: new Date(Date.now() - 1000) }) }
    await expect(acceptWorkspaceInvitation("token", user)).rejects.toThrow("invitation_invalid")
  })

  it("rejects a different signed-in address", async () => {
    db.workspaceInvitation = { findUnique: vi.fn().mockResolvedValue({ id: "i1", workspaceId: "w1", email: "other@example.com", role: "member", acceptedAt: null, expiresAt: future() }) }
    await expect(acceptWorkspaceInvitation("token", user)).rejects.toThrow("invitation_email_mismatch")
  })

  it("is idempotent for the member who already accepted it", async () => {
    db.workspaceInvitation = { findUnique: vi.fn().mockResolvedValue({ id: "i1", workspaceId: "w1", email: user.email, role: "member", acceptedAt: new Date(), expiresAt: future() }) }
    db.workspaceMember = { findUnique: vi.fn().mockResolvedValue({ id: "m1" }) }
    expect(await acceptWorkspaceInvitation("token", user)).toBe("w1")
  })

  it("still refuses a used invitation for someone who is not a member", async () => {
    db.workspaceInvitation = { findUnique: vi.fn().mockResolvedValue({ id: "i1", workspaceId: "w1", email: user.email, role: "member", acceptedAt: new Date(), expiresAt: future() }) }
    db.workspaceMember = { findUnique: vi.fn().mockResolvedValue(null) }
    await expect(acceptWorkspaceInvitation("token", user)).rejects.toThrow("invitation_invalid")
  })

  it("adds the member and marks the invitation accepted, with no seat limit to check", async () => {
    db.workspaceInvitation = { findUnique: vi.fn().mockResolvedValue({ id: "i1", workspaceId: "w1", email: user.email, role: "member", acceptedAt: null, expiresAt: future() }), update: vi.fn().mockReturnValue("accept") }
    db.workspaceMember = { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockReturnValue("upsert") }
    db.documentAuditEvent = { create: vi.fn().mockReturnValue("audit") }

    expect(await acceptWorkspaceInvitation("token", user)).toBe("w1")
    expect(db.$transaction).toHaveBeenCalledWith(["upsert", "accept", "audit"])
  })
})
