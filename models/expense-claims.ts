// Deliberately NOT a "use server" module, matching every other models/*.ts helper: trusts the
// workspaceId it is handed. Server actions live in
// app/(app)/workspaces/[workspaceId]/expense-claim-actions.ts and do the auth + capability gate.
import { canDecideStage, decideStage, findCurrentStage } from "@/lib/approvals/engine"
import { auditEventData, getRequestAuditContext } from "@/lib/audit"
import { prisma } from "@/lib/db"
import { cache } from "react"

export const EXPENSE_CLAIM_STATUSES = ["draft", "submitted", "approved", "rejected"] as const
export type ExpenseClaimStatus = (typeof EXPENSE_CLAIM_STATUSES)[number]
const RESOLVED_STATUSES = new Set<ExpenseClaimStatus>(["approved", "rejected"])

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

/** Every document a claim item can be built from must already be an `expense_receipt`-templated
 * Document in this workspace, and not already claimed elsewhere — both enforced here rather than
 * left to the DB's unique constraint alone, so the caller gets a clear reason instead of a raw
 * constraint-violation error. Shared by createExpenseClaim and addExpenseClaimItems so "what counts
 * as claimable" only has one definition. */
async function validateClaimableDocuments(workspaceId: string, documentIds: string[]) {
  const documents = await prisma.document.findMany({
    where: { id: { in: documentIds }, workspaceId },
    select: { id: true, template: { select: { code: true } } },
  })
  if (documents.length !== documentIds.length) throw new Error("document_not_found")
  if (documents.some((document) => document.template?.code !== "expense_receipt")) throw new Error("document_not_an_expense_receipt")

  const alreadyClaimed = await prisma.expenseClaimItem.findFirst({ where: { workspaceId, documentId: { in: documentIds } }, select: { id: true } })
  if (alreadyClaimed) throw new Error("document_already_claimed")
}

/** Creates the claim and its items in one transaction, "draft" status. */
export async function createExpenseClaim(input: { workspaceId: string; submitterId: string; title?: string | null; documentIds: string[] }) {
  const documentIds = [...new Set(input.documentIds)].slice(0, 200)
  if (!documentIds.length) throw new Error("expense_claim_needs_at_least_one_receipt")
  await validateClaimableDocuments(input.workspaceId, documentIds)

  return prisma.expenseClaim.create({
    data: {
      workspaceId: input.workspaceId, submitterId: input.submitterId, title: input.title?.trim() || null,
      items: { create: documentIds.map((documentId) => ({ workspaceId: input.workspaceId, documentId })) },
    },
    include: { items: { include: { document: { select: { id: true, filename: true, reviewedData: true } } } } },
  })
}

/** `expense_receipt` documents in this workspace with no `ExpenseClaimItem` pointing at them yet —
 * what the "new claim" form offers to pick from. `none: { items: ... }` rather than a left-join
 * exclusion list keeps this a single query instead of fetching all claimed ids first. */
export const listUnclaimedExpenseReceiptDocuments = cache(async (workspaceId: string) => prisma.document.findMany({
  where: { workspaceId, template: { code: "expense_receipt" }, expenseClaimItems: { none: {} } },
  select: { id: true, filename: true, reviewedData: true, rawExtraction: true, receivedAt: true },
  orderBy: { receivedAt: "desc" },
  take: 200,
}))

export type ExpenseClaimFilters = { status?: ExpenseClaimStatus; submitterId?: string }

export const listExpenseClaims = cache(async (workspaceId: string, filters: ExpenseClaimFilters = {}) => prisma.expenseClaim.findMany({
  where: { workspaceId, ...(filters.status ? { status: filters.status } : {}), ...(filters.submitterId ? { submitterId: filters.submitterId } : {}) },
  include: {
    submitter: { select: { id: true, name: true, email: true } },
    items: { include: { document: { select: { id: true, filename: true, reviewedData: true } } } },
    workflow: { include: { stages: { orderBy: { stageIndex: "asc" } } } },
  },
  orderBy: [{ createdAt: "desc" }],
  take: 500,
}))

export const getExpenseClaim = cache(async (workspaceId: string, claimId: string) => prisma.expenseClaim.findFirst({
  where: { id: claimId, workspaceId },
  include: {
    submitter: { select: { id: true, name: true, email: true } },
    items: { include: { document: { select: { id: true, filename: true, reviewedData: true } } } },
    workflow: { include: { stages: { orderBy: { stageIndex: "asc" } } } },
  },
}))

/** Only a draft can be deleted — once submitted, a claim is a decision record even if it's later
 * rejected, the same reasoning ReviewTask never gets hard-deleted after leaving "open". */
export async function deleteExpenseClaim(workspaceId: string, claimId: string) {
  const claim = await prisma.expenseClaim.findFirst({ where: { id: claimId, workspaceId }, select: { id: true, status: true } })
  if (!claim) throw new Error("expense_claim_not_found")
  if (claim.status !== "draft") throw new Error("expense_claim_not_draft")
  await prisma.expenseClaim.delete({ where: { id: claim.id } })
}

/** Adds more unclaimed `expense_receipt` documents to an existing draft — the missing half of
 * WP3.3's "no editing a draft claim's receipts" gap (`createExpenseClaim` only ever took its full
 * document list up front). Draft-only, same as deleteExpenseClaim: once submitted, a claim's
 * receipt list is part of the decision record. */
export async function addExpenseClaimItems(workspaceId: string, claimId: string, documentIds: string[]) {
  const ids = [...new Set(documentIds)].slice(0, 200)
  if (!ids.length) throw new Error("no_receipts_given")
  const claim = await prisma.expenseClaim.findFirst({ where: { id: claimId, workspaceId }, select: { id: true, status: true } })
  if (!claim) throw new Error("expense_claim_not_found")
  if (claim.status !== "draft") throw new Error("expense_claim_not_draft")
  await validateClaimableDocuments(workspaceId, ids)
  await prisma.expenseClaimItem.createMany({ data: ids.map((documentId) => ({ workspaceId, claimId, documentId })) })
}

/** Removes one receipt from a still-draft claim. Refuses to leave the claim with zero items —
 * `submitExpenseClaim` already refuses an empty claim, so an empty draft is a dead end; delete the
 * whole claim instead (deleteExpenseClaim), which also frees its (zero) receipts, trivially. */
export async function removeExpenseClaimItem(workspaceId: string, claimId: string, itemId: string) {
  const claim = await prisma.expenseClaim.findFirst({
    where: { id: claimId, workspaceId },
    select: { id: true, status: true, items: { select: { id: true } } },
  })
  if (!claim) throw new Error("expense_claim_not_found")
  if (claim.status !== "draft") throw new Error("expense_claim_not_draft")
  const item = claim.items.find((candidate) => candidate.id === itemId)
  if (!item) throw new Error("expense_claim_item_not_found")
  if (claim.items.length === 1) throw new Error("expense_claim_needs_at_least_one_receipt")
  await prisma.expenseClaimItem.delete({ where: { id: itemId } })
}

/** Locks the claim in: computes and freezes `total`/`currencyCode` from its items' own extracted
 * data, moves to "submitted", and — if a workflowId is given — starts it at stage 0 exactly the
 * way createReviewTask's own workflowId option does. Refuses an empty claim (all items removed
 * since creation) and refuses re-submitting anything but a draft. */
export async function submitExpenseClaim(input: { workspaceId: string; claimId: string; actorId: string; workflowId?: string | null }) {
  const claim = await prisma.expenseClaim.findFirst({
    where: { id: input.claimId, workspaceId: input.workspaceId },
    include: { items: { include: { document: { select: { reviewedData: true, rawExtraction: true } } } } },
  })
  if (!claim) throw new Error("expense_claim_not_found")
  if (claim.status !== "draft") throw new Error("expense_claim_not_draft")
  if (!claim.items.length) throw new Error("expense_claim_needs_at_least_one_receipt")

  if (input.workflowId) {
    const workflow = await prisma.approvalWorkflow.findFirst({ where: { id: input.workflowId, workspaceId: input.workspaceId }, select: { id: true } })
    if (!workflow) throw new Error("approval_workflow_not_found")
  }

  let total = 0
  let currencyCode: string | null = null
  for (const item of claim.items) {
    const values = (item.document.reviewedData ?? item.document.rawExtraction ?? {}) as Record<string, unknown>
    total += asNumber(values.total) ?? 0
    currencyCode = currencyCode ?? asString(values.currency_code)
  }

  const context = await getRequestAuditContext()
  const [updated] = await prisma.$transaction([
    prisma.expenseClaim.update({
      where: { id: claim.id },
      data: {
        status: "submitted", total, currencyCode, submittedAt: new Date(),
        ...(input.workflowId ? { workflowId: input.workflowId, currentStageIndex: 0 } : {}),
      },
    }),
    prisma.documentAuditEvent.create({ data: auditEventData({ workspaceId: input.workspaceId, actorId: input.actorId, type: "expense_claim_submitted", detail: { claimId: claim.id, total, itemCount: claim.items.length } }, context) }),
  ])
  return updated
}

/** The plain (no-workflow) approve/reject path — mirrors updateReviewTaskStatus. Refuses a claim
 * that has a workflow attached; use decideExpenseClaimStage for that instead, same split as
 * ReviewTask's updateReviewTaskStatus vs decideReviewTaskStage. */
export async function updateExpenseClaimStatus(input: { workspaceId: string; claimId: string; status: "approved" | "rejected"; actorId: string }) {
  const claim = await prisma.expenseClaim.findFirst({ where: { id: input.claimId, workspaceId: input.workspaceId }, select: { id: true, status: true, workflowId: true } })
  if (!claim) throw new Error("expense_claim_not_found")
  if (claim.status !== "submitted") throw new Error("expense_claim_not_submitted")
  if (claim.workflowId) throw new Error("expense_claim_has_workflow")
  const context = await getRequestAuditContext()
  const [updated] = await prisma.$transaction([
    prisma.expenseClaim.update({ where: { id: claim.id }, data: { status: input.status, resolvedAt: new Date() } }),
    prisma.documentAuditEvent.create({ data: auditEventData({ workspaceId: input.workspaceId, actorId: input.actorId, type: "expense_claim_status_changed", detail: { claimId: claim.id, from: claim.status, to: input.status } }, context) }),
  ])
  return updated
}

/** The workflow-aware counterpart — same shape as models/review-tasks.ts's decideReviewTaskStage,
 * just operating on ExpenseClaim's own workflowId/currentStageIndex instead of ReviewTask's. */
export async function decideExpenseClaimStage(input: { workspaceId: string; claimId: string; decision: "approve" | "reject"; actorId: string; actorRole: "owner" | "member" }) {
  const claim = await prisma.expenseClaim.findFirst({
    where: { id: input.claimId, workspaceId: input.workspaceId },
    include: { workflow: { include: { stages: { orderBy: { stageIndex: "asc" } } } } },
  })
  if (!claim) throw new Error("expense_claim_not_found")
  if (!claim.workflow || claim.currentStageIndex === null) throw new Error("expense_claim_has_no_workflow")

  const currentStage = findCurrentStage(claim.workflow.stages, claim.currentStageIndex)
  if (!currentStage) throw new Error("workflow_stage_not_found")
  if (!canDecideStage({ stage: currentStage, actorRole: input.actorRole })) throw new Error("stage_requires_owner")

  const result = decideStage({ stages: claim.workflow.stages, currentStageIndex: claim.currentStageIndex, decision: input.decision })
  const nextStatus = result.outcome === "advance" ? "submitted" : result.outcome
  const nextStageIndex = result.outcome === "advance" ? result.nextStageIndex : claim.currentStageIndex
  const resolvedAt = result.outcome === "advance" ? null : new Date()

  const context = await getRequestAuditContext()
  const [updated] = await prisma.$transaction([
    prisma.expenseClaim.update({ where: { id: claim.id }, data: { status: nextStatus, currentStageIndex: nextStageIndex, resolvedAt } }),
    prisma.documentAuditEvent.create({ data: auditEventData({ workspaceId: input.workspaceId, actorId: input.actorId, type: "expense_claim_stage_decided", detail: { claimId: claim.id, stageIndex: currentStage.stageIndex, stageName: currentStage.name, decision: input.decision, outcome: result.outcome } }, context) }),
  ])
  return updated
}
