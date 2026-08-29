import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))

const {
  createExpenseClaim, decideExpenseClaimStage, deleteExpenseClaim, submitExpenseClaim, updateExpenseClaimStatus,
} = await import("@/models/expense-claims")
const { prisma } = await import("@/lib/db")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(db)) delete db[key]
  db.$transaction = vi.fn(async (operations: unknown[]) => operations)
})

describe("createExpenseClaim", () => {
  it("refuses an empty document list", async () => {
    await expect(createExpenseClaim({ workspaceId: "w1", submitterId: "u1", documentIds: [] })).rejects.toThrow("expense_claim_needs_at_least_one_receipt")
  })

  it("refuses a document outside the workspace", async () => {
    db.document = { findMany: vi.fn().mockResolvedValue([]) }
    await expect(createExpenseClaim({ workspaceId: "w1", submitterId: "u1", documentIds: ["d1"] })).rejects.toThrow("document_not_found")
  })

  it("refuses a document that isn't an expense_receipt", async () => {
    db.document = { findMany: vi.fn().mockResolvedValue([{ id: "d1", template: { code: "invoice" } }]) }
    await expect(createExpenseClaim({ workspaceId: "w1", submitterId: "u1", documentIds: ["d1"] })).rejects.toThrow("document_not_an_expense_receipt")
  })

  it("refuses a document already claimed elsewhere", async () => {
    db.document = { findMany: vi.fn().mockResolvedValue([{ id: "d1", template: { code: "expense_receipt" } }]) }
    db.expenseClaimItem = { findFirst: vi.fn().mockResolvedValue({ id: "existing" }) }
    await expect(createExpenseClaim({ workspaceId: "w1", submitterId: "u1", documentIds: ["d1"] })).rejects.toThrow("document_already_claimed")
  })

  it("creates the claim with an item per document", async () => {
    db.document = { findMany: vi.fn().mockResolvedValue([{ id: "d1", template: { code: "expense_receipt" } }, { id: "d2", template: { code: "expense_receipt" } }]) }
    db.expenseClaimItem = { findFirst: vi.fn().mockResolvedValue(null) }
    db.expenseClaim = { create: vi.fn().mockResolvedValue({ id: "c1" }) }

    await createExpenseClaim({ workspaceId: "w1", submitterId: "u1", title: "Trip", documentIds: ["d1", "d2"] })

    expect(db.expenseClaim.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        workspaceId: "w1", submitterId: "u1", title: "Trip",
        items: { create: [{ workspaceId: "w1", documentId: "d1" }, { workspaceId: "w1", documentId: "d2" }] },
      }),
    }))
  })
})

describe("deleteExpenseClaim", () => {
  it("refuses an unknown claim", async () => {
    db.expenseClaim = { findFirst: vi.fn().mockResolvedValue(null) }
    await expect(deleteExpenseClaim("w1", "c1")).rejects.toThrow("expense_claim_not_found")
  })

  it("refuses a claim that isn't a draft", async () => {
    db.expenseClaim = { findFirst: vi.fn().mockResolvedValue({ id: "c1", status: "submitted" }) }
    await expect(deleteExpenseClaim("w1", "c1")).rejects.toThrow("expense_claim_not_draft")
  })

  it("deletes a draft claim", async () => {
    db.expenseClaim = { findFirst: vi.fn().mockResolvedValue({ id: "c1", status: "draft" }), delete: vi.fn() }
    await deleteExpenseClaim("w1", "c1")
    expect(db.expenseClaim.delete).toHaveBeenCalledWith({ where: { id: "c1" } })
  })
})

describe("submitExpenseClaim", () => {
  it("refuses a claim that isn't a draft", async () => {
    db.expenseClaim = { findFirst: vi.fn().mockResolvedValue({ id: "c1", status: "submitted", items: [] }) }
    await expect(submitExpenseClaim({ workspaceId: "w1", claimId: "c1", actorId: "u1" })).rejects.toThrow("expense_claim_not_draft")
  })

  it("refuses a claim with no items", async () => {
    db.expenseClaim = { findFirst: vi.fn().mockResolvedValue({ id: "c1", status: "draft", items: [] }) }
    await expect(submitExpenseClaim({ workspaceId: "w1", claimId: "c1", actorId: "u1" })).rejects.toThrow("expense_claim_needs_at_least_one_receipt")
  })

  it("sums each item's total and freezes it, without a workflow", async () => {
    db.expenseClaim = {
      findFirst: vi.fn().mockResolvedValue({
        id: "c1", status: "draft",
        items: [
          { document: { reviewedData: { total: 100, currency_code: "USD" }, rawExtraction: null } },
          { document: { reviewedData: { total: 50, currency_code: "USD" }, rawExtraction: null } },
        ],
      }),
      update: vi.fn().mockReturnValue("update"),
    }
    db.documentAuditEvent = { create: vi.fn().mockReturnValue("audit") }

    await submitExpenseClaim({ workspaceId: "w1", claimId: "c1", actorId: "u1" })

    expect(db.expenseClaim.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "c1" },
      data: expect.objectContaining({ status: "submitted", total: 150, currencyCode: "USD" }),
    }))
  })

  it("refuses an unknown workflow", async () => {
    db.expenseClaim = { findFirst: vi.fn().mockResolvedValue({ id: "c1", status: "draft", items: [{ document: { reviewedData: {}, rawExtraction: null } }] }) }
    db.approvalWorkflow = { findFirst: vi.fn().mockResolvedValue(null) }
    await expect(submitExpenseClaim({ workspaceId: "w1", claimId: "c1", actorId: "u1", workflowId: "wf1" })).rejects.toThrow("approval_workflow_not_found")
  })

  it("starts at stage 0 when a workflow is given", async () => {
    db.expenseClaim = {
      findFirst: vi.fn().mockResolvedValue({ id: "c1", status: "draft", items: [{ document: { reviewedData: { total: 10 }, rawExtraction: null } }] }),
      update: vi.fn().mockReturnValue("update"),
    }
    db.approvalWorkflow = { findFirst: vi.fn().mockResolvedValue({ id: "wf1" }) }
    db.documentAuditEvent = { create: vi.fn().mockReturnValue("audit") }

    await submitExpenseClaim({ workspaceId: "w1", claimId: "c1", actorId: "u1", workflowId: "wf1" })

    expect(db.expenseClaim.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ workflowId: "wf1", currentStageIndex: 0 }),
    }))
  })
})

describe("updateExpenseClaimStatus", () => {
  it("refuses a claim that isn't submitted", async () => {
    db.expenseClaim = { findFirst: vi.fn().mockResolvedValue({ id: "c1", status: "draft", workflowId: null }) }
    await expect(updateExpenseClaimStatus({ workspaceId: "w1", claimId: "c1", status: "approved", actorId: "u1" })).rejects.toThrow("expense_claim_not_submitted")
  })

  it("refuses a claim that has a workflow", async () => {
    db.expenseClaim = { findFirst: vi.fn().mockResolvedValue({ id: "c1", status: "submitted", workflowId: "wf1" }) }
    await expect(updateExpenseClaimStatus({ workspaceId: "w1", claimId: "c1", status: "approved", actorId: "u1" })).rejects.toThrow("expense_claim_has_workflow")
  })

  it("approves a plain submitted claim", async () => {
    db.expenseClaim = { findFirst: vi.fn().mockResolvedValue({ id: "c1", status: "submitted", workflowId: null }), update: vi.fn().mockReturnValue("update") }
    db.documentAuditEvent = { create: vi.fn().mockReturnValue("audit") }
    await updateExpenseClaimStatus({ workspaceId: "w1", claimId: "c1", status: "approved", actorId: "u1" })
    expect(db.expenseClaim.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { status: "approved", resolvedAt: expect.any(Date) } })
  })
})

describe("decideExpenseClaimStage", () => {
  it("refuses a claim with no workflow", async () => {
    db.expenseClaim = { findFirst: vi.fn().mockResolvedValue({ id: "c1", workflowId: null, currentStageIndex: null, workflow: null }) }
    await expect(decideExpenseClaimStage({ workspaceId: "w1", claimId: "c1", decision: "approve", actorId: "u1", actorRole: "member" })).rejects.toThrow("expense_claim_has_no_workflow")
  })

  it("refuses a member on an owner-only stage", async () => {
    db.expenseClaim = {
      findFirst: vi.fn().mockResolvedValue({
        id: "c1", currentStageIndex: 0,
        workflow: { stages: [{ stageIndex: 0, requireOwner: true, name: "Finance" }] },
      }),
    }
    await expect(decideExpenseClaimStage({ workspaceId: "w1", claimId: "c1", decision: "approve", actorId: "u1", actorRole: "member" })).rejects.toThrow("stage_requires_owner")
  })

  it("resolves as approved once the last stage clears", async () => {
    db.expenseClaim = {
      findFirst: vi.fn().mockResolvedValue({
        id: "c1", currentStageIndex: 0,
        workflow: { stages: [{ stageIndex: 0, requireOwner: false, name: "Only stage" }] },
      }),
      update: vi.fn().mockReturnValue("update"),
    }
    db.documentAuditEvent = { create: vi.fn().mockReturnValue("audit") }

    await decideExpenseClaimStage({ workspaceId: "w1", claimId: "c1", decision: "approve", actorId: "u1", actorRole: "member" })

    expect(db.expenseClaim.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { status: "approved", currentStageIndex: 0, resolvedAt: expect.any(Date) } })
  })

  it("rejects immediately", async () => {
    db.expenseClaim = {
      findFirst: vi.fn().mockResolvedValue({
        id: "c1", currentStageIndex: 0,
        workflow: { stages: [{ stageIndex: 0, requireOwner: false, name: "First" }, { stageIndex: 1, requireOwner: false, name: "Second" }] },
      }),
      update: vi.fn().mockReturnValue("update"),
    }
    db.documentAuditEvent = { create: vi.fn().mockReturnValue("audit") }

    await decideExpenseClaimStage({ workspaceId: "w1", claimId: "c1", decision: "reject", actorId: "u1", actorRole: "member" })

    expect(db.expenseClaim.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { status: "rejected", currentStageIndex: 0, resolvedAt: expect.any(Date) } })
  })
})
