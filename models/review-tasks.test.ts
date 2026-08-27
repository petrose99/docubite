import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))

const { assignReviewTask, bulkUpdateReviewTaskStatus, createReviewTask, parseReviewTaskStatus, updateReviewTaskStatus } = await import("@/models/review-tasks")
const { prisma } = await import("@/lib/db")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(db)) delete db[key]
  db.$transaction = vi.fn(async (operations: unknown[]) => operations)
})

describe("parseReviewTaskStatus", () => {
  it("accepts a known status", () => {
    expect(parseReviewTaskStatus("in_review")).toBe("in_review")
  })

  it("rejects anything else", () => {
    expect(parseReviewTaskStatus("archived")).toBeNull()
    expect(parseReviewTaskStatus(null)).toBeNull()
  })
})

describe("createReviewTask", () => {
  it("refuses a document outside the workspace", async () => {
    db.document = { findFirst: vi.fn().mockResolvedValue(null) }
    await expect(createReviewTask({ workspaceId: "w1", documentId: "d1", createdById: "u1" })).rejects.toThrow("document_not_found")
  })

  it("creates the task and an audit event in one transaction", async () => {
    db.document = { findFirst: vi.fn().mockResolvedValue({ id: "d1" }) }
    db.reviewTask = { create: vi.fn().mockReturnValue("create-task") }
    db.documentAuditEvent = { create: vi.fn().mockReturnValue("audit") }

    await createReviewTask({ workspaceId: "w1", documentId: "d1", createdById: "u1", detail: "looks off" })

    expect(db.reviewTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ workspaceId: "w1", documentId: "d1", reason: "manual", detail: "looks off" }),
    }))
    expect(db.$transaction).toHaveBeenCalledWith(["create-task", "audit"])
  })
})

describe("updateReviewTaskStatus", () => {
  it("refuses an unknown task", async () => {
    db.reviewTask = { findFirst: vi.fn().mockResolvedValue(null) }
    await expect(updateReviewTaskStatus({ workspaceId: "w1", taskId: "t1", status: "approved", actorId: "u1" })).rejects.toThrow("review_task_not_found")
  })

  it("stamps resolvedAt when moving to a terminal status", async () => {
    db.reviewTask = { findFirst: vi.fn().mockResolvedValue({ id: "t1", documentId: "d1", status: "open" }), update: vi.fn().mockReturnValue("update") }
    db.documentAuditEvent = { create: vi.fn().mockReturnValue("audit") }

    await updateReviewTaskStatus({ workspaceId: "w1", taskId: "t1", status: "approved", actorId: "u1" })

    expect(db.reviewTask.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { status: "approved", resolvedAt: expect.any(Date) } })
  })

  it("leaves resolvedAt null for a non-terminal status", async () => {
    db.reviewTask = { findFirst: vi.fn().mockResolvedValue({ id: "t1", documentId: "d1", status: "open" }), update: vi.fn().mockReturnValue("update") }
    db.documentAuditEvent = { create: vi.fn().mockReturnValue("audit") }

    await updateReviewTaskStatus({ workspaceId: "w1", taskId: "t1", status: "in_review", actorId: "u1" })

    expect(db.reviewTask.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { status: "in_review", resolvedAt: null } })
  })
})

describe("bulkUpdateReviewTaskStatus", () => {
  it("writes one audit event per task actually found in this workspace", async () => {
    db.reviewTask = {
      findMany: vi.fn().mockResolvedValue([{ id: "t1", documentId: "d1", status: "open" }, { id: "t2", documentId: "d2", status: "open" }]),
      updateMany: vi.fn().mockReturnValue("update-many"),
    }
    db.documentAuditEvent = { create: vi.fn((args: unknown) => args) }

    const result = await bulkUpdateReviewTaskStatus({ workspaceId: "w1", taskIds: ["t1", "t2", "t3"], status: "approved", actorId: "u1" })

    expect(result.updated).toBe(2)
    expect(db.reviewTask.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["t1", "t2", "t3"] }, workspaceId: "w1" } }))
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.$transaction.mock.calls[0][0]).toHaveLength(3) // updateMany + 2 audit events
  })

  it("does nothing when none of the ids belong to this workspace", async () => {
    db.reviewTask = { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() }
    const result = await bulkUpdateReviewTaskStatus({ workspaceId: "w1", taskIds: ["t1"], status: "approved", actorId: "u1" })
    expect(result.updated).toBe(0)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

describe("assignReviewTask", () => {
  it("refuses to assign to someone who is not a workspace member", async () => {
    db.reviewTask = { findFirst: vi.fn().mockResolvedValue({ id: "t1", documentId: "d1" }) }
    db.workspaceMember = { findUnique: vi.fn().mockResolvedValue(null) }
    await expect(assignReviewTask({ workspaceId: "w1", taskId: "t1", assigneeId: "u2", actorId: "u1" })).rejects.toThrow("assignee_not_a_member")
  })

  it("allows clearing the assignee without a membership check", async () => {
    db.reviewTask = { findFirst: vi.fn().mockResolvedValue({ id: "t1", documentId: "d1" }), update: vi.fn().mockReturnValue("update") }
    db.workspaceMember = { findUnique: vi.fn() }
    db.documentAuditEvent = { create: vi.fn().mockReturnValue("audit") }

    await assignReviewTask({ workspaceId: "w1", taskId: "t1", assigneeId: null, actorId: "u1" })

    expect(db.workspaceMember.findUnique).not.toHaveBeenCalled()
    expect(db.reviewTask.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { assigneeId: null } })
  })
})
