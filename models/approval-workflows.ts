// Deliberately NOT a "use server" module, matching models/review-tasks.ts and models/bank-matches.ts:
// these helpers trust the workspaceId they are handed. Server actions (WP3.2) will do the auth +
// capability gate before calling into here.
import { auditEventData, getRequestAuditContext } from "@/lib/audit"
import { prisma } from "@/lib/db"
import { cache } from "react"

export type WorkflowStageDraft = { name: string; requireOwner?: boolean }

/** Creates a workflow and its stages in one transaction. Stage order is the array's own order —
 * `stageIndex` is assigned 0, 1, 2... from `stages`, there is no separate reordering input. A
 * workflow needs at least one stage; a zero-stage workflow could never resolve a task attached to
 * it (there would be no "last stage" for decideStage to clear). */
export async function createApprovalWorkflow(input: { workspaceId: string; name: string; stages: WorkflowStageDraft[]; createdById: string | null }) {
  if (!input.stages.length) throw new Error("workflow_needs_at_least_one_stage")
  return prisma.approvalWorkflow.create({
    data: {
      workspaceId: input.workspaceId,
      name: input.name,
      createdById: input.createdById,
      stages: { create: input.stages.map((stage, stageIndex) => ({ workspaceId: input.workspaceId, stageIndex, name: stage.name, requireOwner: stage.requireOwner ?? false })) },
    },
    include: { stages: { orderBy: { stageIndex: "asc" } } },
  })
}

export const listApprovalWorkflows = cache(async (workspaceId: string, opts: { activeOnly?: boolean } = {}) => prisma.approvalWorkflow.findMany({
  where: { workspaceId, ...(opts.activeOnly ? { active: true } : {}) },
  include: { stages: { orderBy: { stageIndex: "asc" } } },
  orderBy: { createdAt: "asc" },
}))

export const getApprovalWorkflow = cache(async (workspaceId: string, workflowId: string) => prisma.approvalWorkflow.findFirst({
  where: { id: workflowId, workspaceId },
  include: { stages: { orderBy: { stageIndex: "asc" } } },
}))

/** Renames or retires a workflow. Replacing its stages is deliberately a separate, more surgical
 * operation (see replaceApprovalWorkflowStages) rather than folded in here — swapping out the
 * stages of a workflow with in-flight ReviewTasks is a bigger decision than a name/active toggle
 * and callers should have to reach for it on purpose. */
export async function updateApprovalWorkflow(input: { workspaceId: string; workflowId: string; name?: string; active?: boolean }) {
  const workflow = await prisma.approvalWorkflow.findFirst({ where: { id: input.workflowId, workspaceId: input.workspaceId }, select: { id: true } })
  if (!workflow) throw new Error("approval_workflow_not_found")
  return prisma.approvalWorkflow.update({
    where: { id: workflow.id },
    data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.active !== undefined ? { active: input.active } : {}) },
    include: { stages: { orderBy: { stageIndex: "asc" } } },
  })
}

/** Wholesale replaces a workflow's stages. Any ReviewTask currently mid-workflow keeps whatever
 * currentStageIndex it already has — if the new stage list is shorter, its next decision could
 * resolve straight to "approved"/land past the end (engine.findCurrentStage would return null,
 * which models/review-tasks.ts's decideReviewTaskStage treats as an error) rather than silently
 * reinterpreting history. Editing stages under an in-flight approval is an edge case this session
 * doesn't try to make graceful — flagging it here for whichever WP builds the settings UI. */
export async function replaceApprovalWorkflowStages(input: { workspaceId: string; workflowId: string; stages: WorkflowStageDraft[] }) {
  if (!input.stages.length) throw new Error("workflow_needs_at_least_one_stage")
  const workflow = await prisma.approvalWorkflow.findFirst({ where: { id: input.workflowId, workspaceId: input.workspaceId }, select: { id: true } })
  if (!workflow) throw new Error("approval_workflow_not_found")
  await prisma.$transaction([
    prisma.approvalWorkflowStage.deleteMany({ where: { workflowId: workflow.id, workspaceId: input.workspaceId } }),
    prisma.approvalWorkflowStage.createMany({ data: input.stages.map((stage, stageIndex) => ({ workflowId: workflow.id, workspaceId: input.workspaceId, stageIndex, name: stage.name, requireOwner: stage.requireOwner ?? false })) }),
  ])
  return getApprovalWorkflow(input.workspaceId, workflow.id)
}

/** Deleting a workflow never deletes the ReviewTasks that pointed at it — ReviewTask.workflowId is
 * ON DELETE SET NULL, so an in-flight or historical task just loses its workflow link and reads as
 * a plain task from then on, rather than cascading data loss into the document review history. */
export async function deleteApprovalWorkflow(workspaceId: string, workflowId: string) {
  const workflow = await prisma.approvalWorkflow.findFirst({ where: { id: workflowId, workspaceId }, select: { id: true } })
  if (!workflow) throw new Error("approval_workflow_not_found")
  await prisma.approvalWorkflow.delete({ where: { id: workflow.id } })
}

/** Attaches a workflow to an existing (already-created) ReviewTask, starting it at stage 0. Used
 * when a workflow is chosen after the task exists (the review-queue UI, or a future automation
 * rule) rather than at creation time — see createReviewTask's own `workflowId` option for the
 * create-time path. Refuses to reattach a task that already has a workflow or is already resolved:
 * both are the caller's bug, not a state this should silently paper over. */
export async function startWorkflowOnReviewTask(input: { workspaceId: string; taskId: string; workflowId: string; actorId: string }) {
  const [task, workflow] = await Promise.all([
    prisma.reviewTask.findFirst({ where: { id: input.taskId, workspaceId: input.workspaceId }, select: { id: true, documentId: true, workflowId: true, status: true } }),
    prisma.approvalWorkflow.findFirst({ where: { id: input.workflowId, workspaceId: input.workspaceId }, select: { id: true } }),
  ])
  if (!task) throw new Error("review_task_not_found")
  if (!workflow) throw new Error("approval_workflow_not_found")
  if (task.workflowId) throw new Error("review_task_already_has_workflow")
  if (task.status !== "open") throw new Error("review_task_not_open")
  const context = await getRequestAuditContext()
  const [updated] = await prisma.$transaction([
    prisma.reviewTask.update({ where: { id: task.id }, data: { workflowId: workflow.id, currentStageIndex: 0, status: "in_review" } }),
    prisma.documentAuditEvent.create({ data: auditEventData({ workspaceId: input.workspaceId, documentId: task.documentId, actorId: input.actorId, type: "review_task_workflow_started", detail: { workflowId: workflow.id } }, context) }),
  ])
  return updated
}
