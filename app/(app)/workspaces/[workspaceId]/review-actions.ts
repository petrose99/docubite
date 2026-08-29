"use server"

import { ActionState } from "@/lib/actions"
import { canDecideStage, findCurrentStage } from "@/lib/approvals/engine"
import { maybeAutopublish } from "@/lib/automation/autopublish"
import { getCurrentUser } from "@/lib/auth"
import { parseTemplateFields } from "@/lib/document-templates"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { prisma } from "@/lib/db"
import { listApprovalWorkflows, startWorkflowOnReviewTask } from "@/models/approval-workflows"
import { listWorkspaceIntegrationConnections } from "@/models/integrations"
import { assignReviewTask, bulkUpdateReviewTaskStatus, createReviewTask, decideReviewTaskStage, getReviewTask, parseReviewTaskStatus, updateReviewTaskStatus } from "@/models/review-tasks"
import { revalidatePath } from "next/cache"
import { errorMessage, NO_ACCESS, paths, requireMember } from "./action-helpers"

/** Review-queue actions, kept out of actions.ts for the same reason dictation-actions.ts is: a
 * smaller "use server" surface is easier to audit for what it lets a caller do. Every action here
 * requires the review-queue module — a workspace without it has no review queue (the sidebar
 * already omits the entry; this is the same gate on the server side, since a URL can be guessed). */
async function requireAccountingMember(workspaceId: string, userId: string) {
  const membership = await requireMember(workspaceId, userId)
  if (!membership) return null
  if (!(await getWorkspaceCapabilities(workspaceId)).has("review-queue")) return null
  return membership
}

export async function createReviewTaskAction(workspaceId: string, documentId: string, detail: string): Promise<ActionState<{ id: string }>> {
  const user = await getCurrentUser()
  if (!(await requireAccountingMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    const task = await createReviewTask({ workspaceId, documentId, reason: "manual", detail: detail.trim() || null, createdById: user.id })
    revalidatePath(paths(workspaceId).review)
    return { success: true, data: { id: task.id } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not create a review task") } }
}

export async function updateReviewTaskStatusAction(workspaceId: string, taskId: string, status: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireAccountingMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  const parsed = parseReviewTaskStatus(status)
  if (!parsed) return { success: false, error: "Invalid status" }
  try {
    const task = await updateReviewTaskStatus({ workspaceId, taskId, status: parsed, actorId: user.id })
    if (parsed === "approved") await maybeAutopublish(workspaceId, task.documentId, user.id)
    revalidatePath(paths(workspaceId).review)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not update the review task") } }
}

export async function bulkUpdateReviewTaskStatusAction(workspaceId: string, taskIds: string[], status: string): Promise<ActionState<{ updated: number }>> {
  const user = await getCurrentUser()
  if (!(await requireAccountingMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  const parsed = parseReviewTaskStatus(status)
  if (!parsed) return { success: false, error: "Invalid status" }
  if (!taskIds.length) return { success: false, error: "Nothing selected" }
  try {
    const result = await bulkUpdateReviewTaskStatus({ workspaceId, taskIds, status: parsed, actorId: user.id })
    if (parsed === "approved") await Promise.all(result.documentIds.map((documentId) => maybeAutopublish(workspaceId, documentId, user.id)))
    revalidatePath(paths(workspaceId).review)
    return { success: true, data: { updated: result.updated } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not update the selected review tasks") } }
}

/** Everything the split-view detail pane (components/workspace/review-inbox.tsx) needs for one
 * task, in a single round trip: the source preview info, extracted fields/values, non-passing
 * checks, and whether/where this document can be pushed — so the client doesn't have to fetch a
 * document, its checks, and its connections separately every time the selection changes. */
export async function getReviewTaskDetailAction(workspaceId: string, taskId: string) {
  const user = await getCurrentUser()
  const membership = await requireAccountingMember(workspaceId, user.id)
  if (!membership) return null
  const task = await getReviewTask(workspaceId, taskId)
  if (!task) return null

  const capabilities = await getWorkspaceCapabilities(workspaceId)
  const fields = parseTemplateFields(task.document.fieldSnapshot)
  const values = (task.document.reviewedData ?? task.document.rawExtraction ?? {}) as Record<string, unknown>
  const workflowsEnabled = capabilities.has("approval-workflows")
  const [checkResults, connections, appliedRule, template, availableWorkflows] = await Promise.all([
    prisma.documentCheckResult.findMany({ where: { workspaceId, documentId: task.document.id }, orderBy: { checkCode: "asc" } }),
    capabilities.has("accounting-push") ? listWorkspaceIntegrationConnections(workspaceId) : Promise.resolve([]),
    task.document.appliedRuleId ? prisma.automationRule.findUnique({ where: { id: task.document.appliedRuleId }, select: { name: true } }) : Promise.resolve(null),
    task.document.templateId ? prisma.documentTemplate.findUnique({ where: { id: task.document.templateId }, select: { code: true } }) : Promise.resolve(null),
    workflowsEnabled ? listApprovalWorkflows(workspaceId, { activeOnly: true }) : Promise.resolve([]),
  ])
  const activeConnection = connections.find((connection) => connection.status === "active") ?? null
  const canPush = task.document.status === "reviewed" && Boolean(activeConnection)
    && Boolean(template?.code) && capabilities.pushableTemplateCodes.includes(template!.code)
  const supplierValue = values.vendor ?? values.merchant
  const supplier = typeof supplierValue === "string" ? supplierValue.trim() : ""

  // Stage progress for a task already on a workflow — null for a plain task, which keeps using
  // the four-button status control unchanged. canDecideCurrentStage folds in the actor's own role
  // so the client never has to re-derive the "owner" gate itself.
  const workflow = task.workflow && task.currentStageIndex !== null ? (() => {
    const stages = task.workflow!.stages.map((stage) => ({ stageIndex: stage.stageIndex, name: stage.name, requireOwner: stage.requireOwner }))
    const currentStage = findCurrentStage(stages, task.currentStageIndex!)
    return {
      id: task.workflow!.id, name: task.workflow!.name, stages, currentStageIndex: task.currentStageIndex!,
      canDecideCurrentStage: currentStage ? canDecideStage({ stage: currentStage, actorRole: membership.role === "owner" ? "owner" : "member" }) : false,
    }
  })() : null

  return {
    id: task.id, status: task.status, assigneeId: task.assigneeId, detail: task.detail,
    document: {
      id: task.document.id, filename: task.document.filename, mimeType: task.document.mimeType,
      storageKey: task.document.storageKey, status: task.document.status,
      fields: fields.filter((field) => field.type !== "array"),
      values,
      supplier,
    },
    checkResults: checkResults.map((check) => ({ id: check.id, checkCode: check.checkCode, status: check.status, message: check.message })),
    appliedRuleName: appliedRule?.name ?? null,
    canPush,
    activeConnectionId: activeConnection?.id ?? null,
    canCreateRule: capabilities.has("supplier-rules") && membership.role === "owner" && supplier.length > 0,
    workflow,
    availableWorkflows: task.status === "open" && !task.workflowId ? availableWorkflows.map((wf) => ({ id: wf.id, name: wf.name, stageCount: wf.stages.length })) : [],
  }
}

/** Attaches an existing workflow to an open, plain (no-workflow-yet) task — see
 * models/approval-workflows.ts's startWorkflowOnReviewTask for the state it refuses. */
export async function startWorkflowOnReviewTaskAction(workspaceId: string, taskId: string, workflowId: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireAccountingMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  if (!(await getWorkspaceCapabilities(workspaceId)).has("approval-workflows")) return { success: false, error: NO_ACCESS }
  try {
    await startWorkflowOnReviewTask({ workspaceId, taskId, workflowId, actorId: user.id })
    revalidatePath(paths(workspaceId).review)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not start that workflow") } }
}

/** The workflow-aware counterpart to updateReviewTaskStatusAction — approve/reject the task's
 * *current* stage rather than writing a status directly. Autopublish fires the same way, only once
 * the decision actually resolves the task as "approved" (the last stage clearing), never on an
 * intermediate stage advance. */
export async function decideReviewTaskStageAction(workspaceId: string, taskId: string, decision: "approve" | "reject"): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  const membership = await requireAccountingMember(workspaceId, user.id)
  if (!membership) return { success: false, error: NO_ACCESS }
  try {
    const task = await decideReviewTaskStage({ workspaceId, taskId, decision, actorId: user.id, actorRole: membership.role === "owner" ? "owner" : "member" })
    if (task.status === "approved") await maybeAutopublish(workspaceId, task.documentId, user.id)
    revalidatePath(paths(workspaceId).review)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not record that decision") } }
}

export async function assignReviewTaskAction(workspaceId: string, taskId: string, assigneeId: string | null): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireAccountingMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    await assignReviewTask({ workspaceId, taskId, assigneeId, actorId: user.id })
    revalidatePath(paths(workspaceId).review)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not assign the review task") } }
}
