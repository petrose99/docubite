import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/prisma/client", () => ({ Prisma: {} }))
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }))
vi.mock("@/models/review-tasks", () => ({ createReviewTask: vi.fn() }))

const { applyAutomationRules, createAutomationRule, updateAutomationRule } = await import("@/models/automation-rules")
const { prisma } = await import("@/lib/db")
const { track } = await import("@/lib/analytics")
const { createReviewTask } = await import("@/models/review-tasks")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(db)) delete db[key]
  db.$transaction = vi.fn(async (operations: unknown[]) => operations)
})

describe("createAutomationRule", () => {
  it("refuses a blank matcher value", async () => {
    await expect(createAutomationRule({ workspaceId: "w1", name: "x", matcher: { type: "exact", value: "   " }, actions: { codingData: {} }, createdById: "u1" })).rejects.toThrow("matcher_value_required")
  })

  it("creates the rule with the given matcher and actions", async () => {
    db.automationRule = { create: vi.fn().mockResolvedValue({ id: "r1" }) }
    await createAutomationRule({ workspaceId: "w1", name: "Acme", matcher: { type: "exact", value: "Acme" }, actions: { codingData: { account: "6000" } }, createdById: "u1" })
    expect(db.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ workspaceId: "w1", name: "Acme", requireReview: false }),
    }))
  })
})

describe("updateAutomationRule", () => {
  it("refuses an unknown rule", async () => {
    db.automationRule = { findFirst: vi.fn().mockResolvedValue(null) }
    await expect(updateAutomationRule({ workspaceId: "w1", ruleId: "r1", actorId: "u1", isActive: false })).rejects.toThrow("automation_rule_not_found")
  })

  it("does not emit a correction event for an isActive-only toggle", async () => {
    db.automationRule = { findFirst: vi.fn().mockResolvedValue({ id: "r1" }), update: vi.fn().mockReturnValue("update") }
    db.documentAuditEvent = { create: vi.fn().mockReturnValue("audit") }
    await updateAutomationRule({ workspaceId: "w1", ruleId: "r1", actorId: "u1", isActive: false })
    expect(track).not.toHaveBeenCalled()
  })

  it("emits a correction event when the matcher changes", async () => {
    db.automationRule = { findFirst: vi.fn().mockResolvedValue({ id: "r1" }), update: vi.fn().mockReturnValue("update") }
    db.documentAuditEvent = { create: vi.fn().mockReturnValue("audit") }
    await updateAutomationRule({ workspaceId: "w1", ruleId: "r1", actorId: "u1", matcher: { type: "contains", value: "acme" } })
    expect(track).toHaveBeenCalledWith("automation_rule_corrected", { ruleId: "r1" }, { workspaceId: "w1", actorId: "u1" })
  })
})

describe("applyAutomationRules", () => {
  const extraction = { templateCode: "invoice", supplierValue: "Acme Supplies", supplierConfidence: 0.9 }

  it("persists coding, bumps hitCount, and writes rule.applied when a rule matches", async () => {
    db.automationRule = {
      findMany: vi.fn().mockResolvedValue([{ id: "r1", matcher: { type: "exact", value: "Acme Supplies" }, actions: { codingData: { account: "6000" } }, minConfidence: null, requireReview: false, isActive: true, createdAt: new Date() }]),
      update: vi.fn().mockReturnValue("bump-hits"),
    }
    db.document = { update: vi.fn().mockReturnValue("update-doc") }
    db.documentAuditEvent = { create: vi.fn().mockReturnValue("audit") }

    await applyAutomationRules({ workspaceId: "w1", documentId: "d1", templateCode: "invoice", extraction })

    expect(db.document.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { codingData: { account: "6000" }, appliedRuleId: "r1" } })
    expect(db.automationRule.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { hitCount: { increment: 1 } } })
    expect(createReviewTask).not.toHaveBeenCalled()
  })

  it("creates a review task and skips coding writes when nothing matches but rules exist", async () => {
    db.automationRule = { findMany: vi.fn().mockResolvedValue([{ id: "r1", matcher: { type: "exact", value: "Someone Else" }, actions: { codingData: {} }, minConfidence: null, requireReview: false, isActive: true, createdAt: new Date() }]) }
    db.document = { update: vi.fn() }

    await applyAutomationRules({ workspaceId: "w1", documentId: "d1", templateCode: "invoice", extraction })

    expect(db.document.update).not.toHaveBeenCalled()
    expect(createReviewTask).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "w1", documentId: "d1", reason: "rule_required" }))
  })

  it("swallows an internal error rather than throwing past the caller", async () => {
    db.automationRule = { findMany: vi.fn().mockRejectedValue(new Error("db down")) }
    await expect(applyAutomationRules({ workspaceId: "w1", documentId: "d1", templateCode: "invoice", extraction })).resolves.toBeUndefined()
  })
})
