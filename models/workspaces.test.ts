import { beforeEach, describe, expect, it, vi } from "vitest"

// Plan limits are stubbed rather than read through lib/plans so these tests assert the rules
// themselves — "when the plan says one seat, refuse the second" — independently of the
// ENFORCE_PLAN_LIMITS switch and of whatever is in the environment. `enforcement.on` is the
// stand-in for that switch: models/workspaces imports PLAN_LIMITS_ENFORCED as a value, so it is
// read through a getter here to stay mutable per test.
const { planLimits, enforcement } = vi.hoisted(() => ({
  planLimits: { members: -1, documents: -1, ai: -1 },
  enforcement: { on: true },
}))
vi.mock("@/lib/plans", () => ({
  getWorkspacePlan: () => ({ code: "test", name: "Test", priceId: "", price: 0, features: [], limits: planLimits }),
  isLimitReached: (used: number, limit: number) => limit >= 0 && used >= limit,
  get PLAN_LIMITS_ENFORCED() { return enforcement.on },
  UNLIMITED_LIMITS: { members: -1, documents: -1, ai: -1 },
  TRIAL_DAYS: 14,
}))
vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/prisma/client", () => ({ Prisma: {}, PrismaClient: vi.fn() }))
vi.mock("@/models/files", () => ({ createFile: vi.fn(), deleteFiles: vi.fn() }))
vi.mock("@/lib/document-storage", () => ({ deleteDocumentSource: vi.fn() }))
vi.mock("@/lib/audit-archive", () => ({ archiveWorkspaceAuditEvents: vi.fn().mockResolvedValue({ archived: 0 }) }))

const {
  acceptWorkspaceInvitation,
  consumeWorkspaceQuota,
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
const { deleteFiles } = await import("@/models/files")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(db)) delete db[key]
  db.$transaction = vi.fn(async (operations: unknown[]) => operations)
  planLimits.members = -1
  planLimits.documents = -1
  planLimits.ai = -1
  enforcement.on = true
})

/** consumeWorkspaceQuota reads the exemption out of the same row it reads the plan from, so a
 * stub subscription always carries the `workspace.members` array the include produces: one entry
 * means an admin owns the workspace, empty means nobody does. */
const subscriptionRow = (overrides: Record<string, unknown> = {}, adminOwner = false) => ({
  planCode: "test",
  status: "active",
  trialEndsAt: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  workspace: { members: adminOwner ? [{ userId: "admin-1" }] : [] },
  ...overrides,
})

/** The usage-period upsert plus the conditional increment, which is the whole of the metering.
 * `claimed` is what updateMany reports back — 0 is how the atomic claim says "at the limit". */
const usageDb = (claimed: number) => {
  const updateMany = vi.fn().mockResolvedValue({ count: claimed })
  db.workspaceUsagePeriod = { upsert: vi.fn().mockResolvedValue({ id: "usage-1" }), updateMany }
  return updateMany
}

describe("consumeWorkspaceQuota", () => {
  const expired = new Date("2026-01-01T00:00:00Z")
  const now = new Date("2026-02-01T00:00:00Z")

  it("refuses an expired trial rather than letting `trialing` mean unlimited forever", async () => {
    db.workspaceSubscription = { findUnique: vi.fn().mockResolvedValue(subscriptionRow({ status: "trialing", trialEndsAt: expired })) }
    usageDb(1)
    await expect(consumeWorkspaceQuota("w1", "ai", now)).rejects.toThrow("trial_expired")
    expect(db.workspaceUsagePeriod.updateMany).not.toHaveBeenCalled()
  })

  it("allows a trial that has not run out yet", async () => {
    db.workspaceSubscription = { findUnique: vi.fn().mockResolvedValue(subscriptionRow({ status: "trialing", trialEndsAt: new Date("2026-03-01T00:00:00Z") })) }
    usageDb(1)
    await expect(consumeWorkspaceQuota("w1", "ai", now)).resolves.toBeTruthy()
  })

  it("ignores the expired trial while enforcement is off", async () => {
    enforcement.on = false
    db.workspaceSubscription = { findUnique: vi.fn().mockResolvedValue(subscriptionRow({ status: "trialing", trialEndsAt: expired })) }
    usageDb(1)
    await expect(consumeWorkspaceQuota("w1", "ai", now)).resolves.toBeTruthy()
  })

  it("refuses a canceled subscription", async () => {
    db.workspaceSubscription = { findUnique: vi.fn().mockResolvedValue(subscriptionRow({ status: "canceled" })) }
    usageDb(1)
    await expect(consumeWorkspaceQuota("w1", "document", now)).rejects.toThrow("subscription_inactive")
  })

  it("refuses a canceled subscription even with enforcement off — it is a Stripe fact, not a limit", async () => {
    enforcement.on = false
    db.workspaceSubscription = { findUnique: vi.fn().mockResolvedValue(subscriptionRow({ status: "past_due" })) }
    usageDb(1)
    await expect(consumeWorkspaceQuota("w1", "document", now)).rejects.toThrow("subscription_inactive")
  })

  it("refuses once the period's allowance is spent", async () => {
    planLimits.documents = 200
    db.workspaceSubscription = { findUnique: vi.fn().mockResolvedValue(subscriptionRow()) }
    const updateMany = usageDb(0)
    await expect(consumeWorkspaceQuota("w1", "document", now)).rejects.toThrow("document_quota_exhausted")
    // The refusal is the conditional update itself, not a read-then-check: two uploads racing at
    // the limit must not both see 199.
    expect(updateMany.mock.calls[0][0].where.inboundDocumentCount).toEqual({ lt: 200 })
  })

  it("exempts an admin-owned workspace from the trial clock, the Stripe status and the limits — while still counting", async () => {
    planLimits.ai = 0
    db.workspaceSubscription = { findUnique: vi.fn().mockResolvedValue(subscriptionRow({ status: "canceled", trialEndsAt: expired }, true)) }
    const updateMany = usageDb(1)

    await expect(consumeWorkspaceQuota("w1", "ai", now)).resolves.toBeTruthy()
    // Unconditional increment: no `lt` guard, because the limit is unlimited for this workspace.
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: "usage-1" })
    expect(updateMany.mock.calls[0][0].data).toEqual({ aiExtractionCount: { increment: 1 } })
  })
})

describe("createTeamWorkspace", () => {
  it("refuses a single-seat plan", async () => {
    planLimits.members = 1
    db.workspaceMember = { findMany: vi.fn().mockResolvedValue([{ workspace: { subscription: { planCode: "starter" } } }]) }
    await expect(createTeamWorkspace({ id: "u1", name: "A", email: "a@example.com", role: "user" }, "Team")).rejects.toThrow("team_workspaces_require_upgrade")
  })

  it("lets an admin through the same single-seat plan", async () => {
    planLimits.members = 1
    db.workspaceMember = { findMany: vi.fn().mockResolvedValue([{ workspace: { subscription: { planCode: "starter" } } }]) }
    db.workspace = { create: vi.fn().mockResolvedValue({ id: "w-new" }) }

    const workspace = await createTeamWorkspace({ id: "u1", name: "A", email: "a@example.com", role: "admin" }, "Team")

    expect(workspace).toEqual({ id: "w-new" })
  })
})

describe("createWorkspaceInvitation", () => {
  it("refuses a seat past the plan's limit", async () => {
    planLimits.members = 1
    db.workspaceMember = {
      findUnique: vi.fn().mockResolvedValue({ role: "owner", workspace: {} }),
      count: vi.fn().mockResolvedValue(1),
      findFirst: vi.fn().mockResolvedValue(null),
    }
    db.workspace = { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "w1", name: "W", subscription: { planCode: "starter" } }) }
    await expect(createWorkspaceInvitation({ workspaceId: "w1", ownerId: "u1", email: "b@example.com" })).rejects.toThrow("member_quota_exhausted")
  })

  it("allows it past the limit when an admin owns the workspace", async () => {
    planLimits.members = 1
    db.workspaceMember = {
      findUnique: vi.fn().mockResolvedValue({ role: "owner", workspace: {} }),
      count: vi.fn().mockResolvedValue(5),
      // The exemption probe and the already-a-member check share findFirst: admin owner, then no
      // existing member for the invited address.
      findFirst: vi.fn().mockResolvedValueOnce({ userId: "admin-1" }).mockResolvedValueOnce(null),
    }
    db.workspace = { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "w1", name: "W", subscription: { planCode: "starter" } }) }
    db.user = { findUnique: vi.fn().mockResolvedValue({ email: "owner@example.com" }) }
    db.workspaceInvitation = { deleteMany: vi.fn(), create: vi.fn().mockResolvedValue({ id: "i1" }) }

    const result = await createWorkspaceInvitation({ workspaceId: "w1", ownerId: "u1", email: "b@example.com" })

    expect(result.workspaceName).toBe("W")
  })
})

describe("updateWorkspaceMemberRole", () => {
  it("refuses to demote the only owner", async () => {
    db.workspaceMember = {
      findUnique: vi.fn().mockResolvedValue({ id: "m1", role: "owner" }),
      count: vi.fn().mockResolvedValue(1),
      update: vi.fn(),
    }
    await expect(updateWorkspaceMemberRole({ workspaceId: "w1", memberUserId: "u1", role: "member" })).rejects.toThrow("last_owner_required")
    expect(db.workspaceMember.update).not.toHaveBeenCalled()
  })

  it("demotes an owner once a second owner exists, without consulting the plan's seat limit", async () => {
    db.workspaceMember = {
      findUnique: vi.fn().mockResolvedValue({ id: "m1", role: "owner" }),
      count: vi.fn().mockResolvedValue(2),
      update: vi.fn().mockResolvedValue({ id: "m1", role: "member" }),
    }
    // Seats gate adding people; re-checking here would freeze a downgraded workspace.
    db.workspaceSubscription = { findUnique: vi.fn() }

    await updateWorkspaceMemberRole({ workspaceId: "w1", memberUserId: "u1", role: "member" })

    expect(db.workspaceMember.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { role: "member" } })
    expect(db.workspaceSubscription.findUnique).not.toHaveBeenCalled()
  })

  it("rejects an unknown member", async () => {
    db.workspaceMember = { findUnique: vi.fn().mockResolvedValue(null), count: vi.fn(), update: vi.fn() }
    await expect(updateWorkspaceMemberRole({ workspaceId: "w1", memberUserId: "nobody", role: "owner" })).rejects.toThrow("member_not_found")
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

    await transferWorkspaceOwnership({ workspaceId: "w1", actorId: "u1", targetUserId: "u2" })

    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.$transaction.mock.calls[0][0]).toEqual([
      { where: { workspaceId_userId: { workspaceId: "w1", userId: "u2" } }, data: { role: "owner" } },
      { where: { workspaceId_userId: { workspaceId: "w1", userId: "u1" } }, data: { role: "member" } },
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
    db.workspaceSubscription = { findUnique: vi.fn().mockResolvedValue({ status: "canceled", stripeSubscriptionId: null }) }
    db.documentFile = { findMany: filePages(250) }
    db.document = { findMany: vi.fn().mockResolvedValue([]) }
    db.workspace = { delete: vi.fn() }
    vi.mocked(deleteFiles).mockImplementation(async (_workspaceId, ids) => ({ deleted: ids.length }))

    await deleteWorkspace({ workspaceId: "w1", actorId: "u1" })

    expect(deleteFiles).toHaveBeenCalledTimes(3)
    expect(vi.mocked(deleteFiles).mock.calls.map((call) => call[1].length)).toEqual([100, 100, 50])
    expect(db.workspace.delete).toHaveBeenCalledWith({ where: { id: "w1" } })
  })

  it("refuses while a live Stripe subscription is attached", async () => {
    db.workspaceSubscription = { findUnique: vi.fn().mockResolvedValue({ status: "active", stripeSubscriptionId: "sub_1" }) }
    db.workspace = { delete: vi.fn() }
    await expect(deleteWorkspace({ workspaceId: "w1", actorId: "u1" })).rejects.toThrow("cancel_subscription_first")
    expect(db.workspace.delete).not.toHaveBeenCalled()
  })
})

describe("revokeWorkspaceInvitation", () => {
  it("scopes the delete by workspace as well as invitation id", async () => {
    db.workspaceInvitation = { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) }
    await revokeWorkspaceInvitation("w1", "i1")
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

  it("rejects when the plan has no seat left", async () => {
    planLimits.members = 1
    db.workspaceInvitation = { findUnique: vi.fn().mockResolvedValue({ id: "i1", workspaceId: "w1", email: user.email, role: "member", acceptedAt: null, expiresAt: future() }) }
    db.workspace = { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "w1", subscription: { planCode: "starter" } }) }
    db.workspaceMember = { count: vi.fn().mockResolvedValue(1), findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null) }
    await expect(acceptWorkspaceInvitation("token", user)).rejects.toThrow("member_quota_exhausted")
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

  it("adds the member and marks the invitation accepted", async () => {
    db.workspaceInvitation = { findUnique: vi.fn().mockResolvedValue({ id: "i1", workspaceId: "w1", email: user.email, role: "member", acceptedAt: null, expiresAt: future() }), update: vi.fn().mockReturnValue("accept") }
    db.workspace = { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "w1", subscription: { planCode: "growth" } }) }
    db.workspaceMember = { count: vi.fn().mockResolvedValue(1), findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockReturnValue("upsert") }

    expect(await acceptWorkspaceInvitation("token", user)).toBe("w1")
    expect(db.$transaction).toHaveBeenCalledWith(["upsert", "accept"])
  })
})
