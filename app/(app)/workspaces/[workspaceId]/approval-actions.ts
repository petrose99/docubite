"use server"

import { ActionState } from "@/lib/actions"
import { getCurrentUser } from "@/lib/auth"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { createApprovalWorkflow, deleteApprovalWorkflow, updateApprovalWorkflow, type WorkflowStageDraft } from "@/models/approval-workflows"
import { revalidatePath } from "next/cache"
import { errorMessage, NO_ACCESS, paths, requireMember } from "./action-helpers"

/** Building and editing workflows is owner-only, same bar as automation-rules.ts's rule creation
 * — both are workspace-wide policy, not a per-document action any member should be able to change
 * out from under everyone else. */
async function requireApprovalsOwner(workspaceId: string, userId: string) {
  const membership = await requireMember(workspaceId, userId, ["owner"])
  if (!membership) return null
  if (!(await getWorkspaceCapabilities(workspaceId)).has("approval-workflows")) return null
  return membership
}

/** Parses the settings page's dynamic stage-row inputs: `stageName_0`, `stageName_1`, ... paired
 * with `stageRequireOwner_0`, etc., plus a `stageCount` telling us how many rows the form actually
 * rendered. Blank-named rows are dropped (a person adding then abandoning a row shouldn't produce
 * an unnamed stage) — see createApprovalWorkflowAction's own check for what happens if that leaves
 * nothing at all. */
function parseStageRows(formData: FormData): WorkflowStageDraft[] {
  const count = Number(formData.get("stageCount") || 0)
  const stages: WorkflowStageDraft[] = []
  for (let index = 0; index < count; index++) {
    const name = String(formData.get(`stageName_${index}`) || "").trim()
    if (!name) continue
    stages.push({ name, requireOwner: formData.get(`stageRequireOwner_${index}`) === "on" })
  }
  return stages
}

export async function createApprovalWorkflowAction(workspaceId: string, formData: FormData): Promise<ActionState<{ id: string }>> {
  const user = await getCurrentUser()
  if (!(await requireApprovalsOwner(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  const name = String(formData.get("name") || "").trim()
  if (!name) return { success: false, error: "Name the workflow" }
  const stages = parseStageRows(formData)
  if (!stages.length) return { success: false, error: "Add at least one named stage" }
  try {
    const workflow = await createApprovalWorkflow({ workspaceId, name, stages, createdById: user.id })
    revalidatePath(paths(workspaceId).approvals)
    return { success: true, data: { id: workflow.id } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not create the workflow") } }
}

export async function setApprovalWorkflowActiveAction(workspaceId: string, workflowId: string, active: boolean): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireApprovalsOwner(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    await updateApprovalWorkflow({ workspaceId, workflowId, active })
    revalidatePath(paths(workspaceId).approvals)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not update the workflow") } }
}

export async function deleteApprovalWorkflowAction(workspaceId: string, workflowId: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireApprovalsOwner(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    await deleteApprovalWorkflow(workspaceId, workflowId)
    revalidatePath(paths(workspaceId).approvals)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not delete the workflow") } }
}
