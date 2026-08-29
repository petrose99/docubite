// Deliberately NOT a "use server" module, matching models/documents.ts and models/workspaces.ts:
// these helpers trust the workspaceId they are handed. Server actions live in
// app/(app)/workspaces/[workspaceId]/review-actions.ts and do the auth.
import { canDecideStage, decideStage, findCurrentStage } from "@/lib/approvals/engine"
import { auditEventData, getRequestAuditContext } from "@/lib/audit"
import { prisma } from "@/lib/db"
import { cache } from "react"

export const REVIEW_TASK_STATUSES = ["open", "in_review", "approved", "rejected"] as const
export type ReviewTaskStatus = (typeof REVIEW_TASK_STATUSES)[number]
const RESOLVED_STATUSES = new Set<ReviewTaskStatus>(["approved", "rejected"])

export const REVIEW_TASK_REASONS = ["manual", "low_confidence", "rule_required", "check_failed"] as const
export type ReviewTaskReason = (typeof REVIEW_TASK_REASONS)[number]

export function parseReviewTaskStatus(value: unknown): ReviewTaskStatus | null {
  return REVIEW_TASK_STATUSES.includes(value as ReviewTaskStatus) ? (value as ReviewTaskStatus) : null
}

/** Manual creation is the only path a person can trigger today — WP11 (automation rules) and
 * WP12 (deterministic checks) are what will call this with "low_confidence"/"rule_required"/
 * "check_failed" once they land.
 *
 * `workflowId` (Dext-parity Phase 3 WP3.1) is optional: passing one starts the task at stage 0
 * (status "in_review") instead of the plain "open" default. It is the caller's job to have already
 * confirmed the workflow belongs to this workspace — this function does not re-validate it, since
 * every current caller already has the workflow row in hand (e.g. from a workspace's configured
 * default). Attaching a workflow to a task that already exists uses
 * models/approval-workflows.ts's startWorkflowOnReviewTask instead. */
export async function createReviewTask(input: {
  workspaceId: string; documentId: string; reason?: ReviewTaskReason; detail?: string | null
  priority?: number; dueAt?: Date | null; assigneeId?: string | null; createdById: string | null
  workflowId?: string | null
}) {
  const document = await prisma.document.findFirst({ where: { id: input.documentId, workspaceId: input.workspaceId }, select: { id: true } })
  if (!document) throw new Error("document_not_found")
  const context = await getRequestAuditContext()
  const [task] = await prisma.$transaction([
    prisma.reviewTask.create({
      data: {
        workspaceId: input.workspaceId, documentId: input.documentId, reason: input.reason ?? "manual",
        detail: input.detail ?? null, priority: input.priority ?? 0, dueAt: input.dueAt ?? null,
        assigneeId: input.assigneeId ?? null, createdById: input.createdById,
        ...(input.workflowId ? { workflowId: input.workflowId, currentStageIndex: 0, status: "in_review" } : {}),
      },
    }),
    prisma.documentAuditEvent.create({ data: auditEventData({ workspaceId: input.workspaceId, documentId: input.documentId, actorId: input.createdById, type: "review_task_created" }, context) }),
  ])
  return task
}

export type ReviewTaskFilters = { status?: ReviewTaskStatus; assigneeId?: string | null; reason?: ReviewTaskReason }

export const listReviewTasks = cache(async (workspaceId: string, filters: ReviewTaskFilters = {}) => prisma.reviewTask.findMany({
  where: {
    workspaceId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.reason ? { reason: filters.reason } : {}),
    ...(filters.assigneeId !== undefined ? { assigneeId: filters.assigneeId } : {}),
  },
  include: {
    document: {
      select: {
        id: true, filename: true, status: true, receivedAt: true, confidence: true,
        template: { select: { name: true, code: true } },
        appliedRule: { select: { name: true } },
        checkResults: { select: { checkCode: true, status: true, message: true }, where: { status: { not: "pass" } } },
      },
    },
    assignee: { select: { id: true, name: true, email: true } },
  },
  orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
  take: 500,
}))

export const getReviewTask = cache(async (workspaceId: string, taskId: string) => prisma.reviewTask.findFirst({
  where: { id: taskId, workspaceId },
  include: {
    document: true,
    assignee: { select: { id: true, name: true, email: true } },
    createdBy: { select: { id: true, name: true, email: true } },
    workflow: { include: { stages: { orderBy: { stageIndex: "asc" } } } },
  },
}))

/** Every transition is written to DocumentAuditEvent, not just terminal ones — this is the
 * reviewed history WP11's rule-correction flow must only ever append to, never rewrite. */
export async function updateReviewTaskStatus(input: { workspaceId: string; taskId: string; status: ReviewTaskStatus; actorId: string }) {
  const task = await prisma.reviewTask.findFirst({ where: { id: input.taskId, workspaceId: input.workspaceId }, select: { id: true, documentId: true, status: true } })
  if (!task) throw new Error("review_task_not_found")
  const context = await getRequestAuditContext()
  const resolvedAt = RESOLVED_STATUSES.has(input.status) ? new Date() : null
  const [updated] = await prisma.$transaction([
    prisma.reviewTask.update({ where: { id: task.id }, data: { status: input.status, resolvedAt } }),
    prisma.documentAuditEvent.create({ data: auditEventData({ workspaceId: input.workspaceId, documentId: task.documentId, actorId: input.actorId, type: "review_task_status_changed", detail: { from: task.status, to: input.status } }, context) }),
  ])
  return updated
}

/** The workflow-aware counterpart to updateReviewTaskStatus (Dext-parity Phase 3 WP3.1): for a
 * task with a workflow attached, a single "approve"/"reject" decision on its *current* stage,
 * never a direct status write — approving mid-workflow only ever advances currentStageIndex and
 * keeps status "in_review" until the last stage clears. Throws review_task_has_no_workflow for a
 * plain task; callers (WP3.2's actions layer) are expected to branch on task.workflowId and call
 * updateReviewTaskStatus for the plain case instead of routing everything through here. */
export async function decideReviewTaskStage(input: { workspaceId: string; taskId: string; decision: "approve" | "reject"; actorId: string; actorRole: "owner" | "member" }) {
  const task = await prisma.reviewTask.findFirst({
    where: { id: input.taskId, workspaceId: input.workspaceId },
    include: { workflow: { include: { stages: { orderBy: { stageIndex: "asc" } } } } },
  })
  if (!task) throw new Error("review_task_not_found")
  if (!task.workflow || task.currentStageIndex === null) throw new Error("review_task_has_no_workflow")

  const currentStage = findCurrentStage(task.workflow.stages, task.currentStageIndex)
  if (!currentStage) throw new Error("workflow_stage_not_found")
  if (!canDecideStage({ stage: currentStage, actorRole: input.actorRole })) throw new Error("stage_requires_owner")

  const result = decideStage({ stages: task.workflow.stages, currentStageIndex: task.currentStageIndex, decision: input.decision })
  const nextStatus = result.outcome === "advance" ? "in_review" : result.outcome
  const nextStageIndex = result.outcome === "advance" ? result.nextStageIndex : task.currentStageIndex
  const resolvedAt = result.outcome === "advance" ? null : new Date()

  const context = await getRequestAuditContext()
  const [updated] = await prisma.$transaction([
    prisma.reviewTask.update({ where: { id: task.id }, data: { status: nextStatus, currentStageIndex: nextStageIndex, resolvedAt } }),
    prisma.documentAuditEvent.create({ data: auditEventData({ workspaceId: input.workspaceId, documentId: task.documentId, actorId: input.actorId, type: "review_task_stage_decided", detail: { stageIndex: currentStage.stageIndex, stageName: currentStage.name, decision: input.decision, outcome: result.outcome } }, context) }),
  ])
  return updated
}

/** Scoped updateMany, per the roadmap's "bulk actions = scoped updateMany" — but a per-row audit
 * event still has to exist for each task actually changed, since the audit trail is what has to
 * answer "who approved this specific document" later, not just "a bulk approval happened". */
export async function bulkUpdateReviewTaskStatus(input: { workspaceId: string; taskIds: string[]; status: ReviewTaskStatus; actorId: string }) {
  const tasks = await prisma.reviewTask.findMany({ where: { id: { in: input.taskIds.slice(0, 200) }, workspaceId: input.workspaceId }, select: { id: true, documentId: true, status: true } })
  if (!tasks.length) return { updated: 0, documentIds: [] as string[] }
  const context = await getRequestAuditContext()
  const resolvedAt = RESOLVED_STATUSES.has(input.status) ? new Date() : null
  await prisma.$transaction([
    prisma.reviewTask.updateMany({ where: { id: { in: tasks.map((task) => task.id) }, workspaceId: input.workspaceId }, data: { status: input.status, resolvedAt } }),
    ...tasks.map((task) => prisma.documentAuditEvent.create({ data: auditEventData({ workspaceId: input.workspaceId, documentId: task.documentId, actorId: input.actorId, type: "review_task_status_changed", detail: { from: task.status, to: input.status, bulk: true } }, context) })),
  ])
  return { updated: tasks.length, documentIds: tasks.map((task) => task.documentId) }
}

/** Assignment is its own audit event, distinct from a status change — "who is responsible" and
 * "what happened to it" are different questions a compliance review might ask separately. */
export async function assignReviewTask(input: { workspaceId: string; taskId: string; assigneeId: string | null; actorId: string }) {
  const task = await prisma.reviewTask.findFirst({ where: { id: input.taskId, workspaceId: input.workspaceId }, select: { id: true, documentId: true } })
  if (!task) throw new Error("review_task_not_found")
  if (input.assigneeId) {
    const member = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: input.workspaceId, userId: input.assigneeId } }, select: { id: true } })
    if (!member) throw new Error("assignee_not_a_member")
  }
  const context = await getRequestAuditContext()
  const [updated] = await prisma.$transaction([
    prisma.reviewTask.update({ where: { id: task.id }, data: { assigneeId: input.assigneeId } }),
    prisma.documentAuditEvent.create({ data: auditEventData({ workspaceId: input.workspaceId, documentId: task.documentId, actorId: input.actorId, type: "review_task_assigned", detail: { assigneeId: input.assigneeId } }, context) }),
  ])
  return updated
}
