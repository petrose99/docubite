"use server"

import { ActionState } from "@/lib/actions"
import { getCurrentUser } from "@/lib/auth"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { assignReviewTask, bulkUpdateReviewTaskStatus, createReviewTask, parseReviewTaskStatus, updateReviewTaskStatus } from "@/models/review-tasks"
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
    await updateReviewTaskStatus({ workspaceId, taskId, status: parsed, actorId: user.id })
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
    revalidatePath(paths(workspaceId).review)
    return { success: true, data: result }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not update the selected review tasks") } }
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
