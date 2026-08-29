import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))

const {
  createApprovalWorkflow, deleteApprovalWorkflow, replaceApprovalWorkflowStages, startWorkflowOnReviewTask, updateApprovalWorkflow,
} = await import("@/models/approval-workflows")
const { prisma } = await import("@/lib/db")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(db)) delete db[key]
  db.$transaction = vi.fn(async (operations: unknown[]) => operations)
})

describe("createApprovalWorkflow", () => {
  it("refuses a workflow with no stages", async () => {
    await expect(createApprovalWorkflow({ workspaceId: "w1", name: "Empty", stages: [], createdById: "u1" })).rejects.toThrow("workflow_needs_at_least_one_stage")
  })

  it("assigns stageIndex from array order and defaults requireOwner to false", async () => {
    db.approvalWorkflow = { create: vi.fn().mockResolvedValue({ id: "wf1" }) }

    await createApprovalWorkflow({
      workspaceId: "w1", name: "Two-step", createdById: "u1",
      stages: [{ name: "First pass" }, { name: "Owner sign-off", requireOwner: true }],
    })

    expect(db.approvalWorkflow.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        workspaceId: "w1", name: "Two-step",
        stages: { create: [
          { workspaceId: "w1", stageIndex: 0, name: "First pass", requireOwner: false },
          { workspaceId: "w1", stageIndex: 1, name: "Owner sign-off", requireOwner: true },
        ] },
      }),
    }))
  })
})

describe("updateApprovalWorkflow", () => {
  it("refuses an unknown workflow", async () => {
    db.approvalWorkflow = { findFirst: vi.fn().mockResolvedValue(null) }
    await expect(updateApprovalWorkflow({ workspaceId: "w1", workflowId: "wf1", active: false })).rejects.toThrow("approval_workflow_not_found")
  })

  it("only writes the fields that were passed", async () => {
    db.approvalWorkflow = { findFirst: vi.fn().mockResolvedValue({ id: "wf1" }), update: vi.fn().mockResolvedValue({ id: "wf1" }) }
    await updateApprovalWorkflow({ workspaceId: "w1", workflowId: "wf1", active: false })
    expect(db.approvalWorkflow.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "wf1" }, data: { active: false } }))
  })
})

describe("replaceApprovalWorkflowStages", () => {
  it("refuses an empty stage list", async () => {
    await expect(replaceApprovalWorkflowStages({ workspaceId: "w1", workflowId: "wf1", stages: [] })).rejects.toThrow("workflow_needs_at_least_one_stage")
  })

  it("deletes and recreates stages in one transaction", async () => {
    db.approvalWorkflow = { findFirst: vi.fn().mockResolvedValue({ id: "wf1" }) }
    db.approvalWorkflowStage = { deleteMany: vi.fn().mockReturnValue("delete"), createMany: vi.fn().mockReturnValue("create") }

    await replaceApprovalWorkflowStages({ workspaceId: "w1", workflowId: "wf1", stages: [{ name: "Only stage" }] })

    expect(db.approvalWorkflowStage.deleteMany).toHaveBeenCalledWith({ where: { workflowId: "wf1", workspaceId: "w1" } })
    expect(db.approvalWorkflowStage.createMany).toHaveBeenCalledWith({ data: [{ workflowId: "wf1", workspaceId: "w1", stageIndex: 0, name: "Only stage", requireOwner: false }] })
  })
})

describe("deleteApprovalWorkflow", () => {
  it("refuses an unknown workflow", async () => {
    db.approvalWorkflow = { findFirst: vi.fn().mockResolvedValue(null) }
    await expect(deleteApprovalWorkflow("w1", "wf1")).rejects.toThrow("approval_workflow_not_found")
  })
})

describe("startWorkflowOnReviewTask", () => {
  it("refuses a task that already has a workflow", async () => {
    db.reviewTask = { findFirst: vi.fn().mockResolvedValue({ id: "t1", documentId: "d1", workflowId: "wf-old", status: "open" }) }
    db.approvalWorkflow = { findFirst: vi.fn().mockResolvedValue({ id: "wf1" }) }
    await expect(startWorkflowOnReviewTask({ workspaceId: "w1", taskId: "t1", workflowId: "wf1", actorId: "u1" })).rejects.toThrow("review_task_already_has_workflow")
  })

  it("refuses a task that isn't open", async () => {
    db.reviewTask = { findFirst: vi.fn().mockResolvedValue({ id: "t1", documentId: "d1", workflowId: null, status: "approved" }) }
    db.approvalWorkflow = { findFirst: vi.fn().mockResolvedValue({ id: "wf1" }) }
    await expect(startWorkflowOnReviewTask({ workspaceId: "w1", taskId: "t1", workflowId: "wf1", actorId: "u1" })).rejects.toThrow("review_task_not_open")
  })

  it("attaches the workflow at stage 0 and sets status in_review", async () => {
    db.reviewTask = { findFirst: vi.fn().mockResolvedValue({ id: "t1", documentId: "d1", workflowId: null, status: "open" }), update: vi.fn().mockReturnValue("update") }
    db.approvalWorkflow = { findFirst: vi.fn().mockResolvedValue({ id: "wf1" }) }
    db.documentAuditEvent = { create: vi.fn().mockReturnValue("audit") }

    await startWorkflowOnReviewTask({ workspaceId: "w1", taskId: "t1", workflowId: "wf1", actorId: "u1" })

    expect(db.reviewTask.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { workflowId: "wf1", currentStageIndex: 0, status: "in_review" } })
  })
})
