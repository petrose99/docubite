"use server"

import { ActionState } from "@/lib/actions"
import { getCurrentUser } from "@/lib/auth"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import {
  addExpenseClaimItems, createExpenseClaim, decideExpenseClaimStage, deleteExpenseClaim,
  removeExpenseClaimItem, submitExpenseClaim, updateExpenseClaimStatus,
} from "@/models/expense-claims"
import { revalidatePath } from "next/cache"
import { errorMessage, NO_ACCESS, paths, requireMember } from "./action-helpers"

/** Every action here requires the expense-approvals module — same server-side mirror of the
 * sidebar gate as review-actions.ts's requireAccountingMember. */
async function requireExpenseClaimsMember(workspaceId: string, userId: string) {
  const membership = await requireMember(workspaceId, userId)
  if (!membership) return null
  if (!(await getWorkspaceCapabilities(workspaceId)).has("expense-approvals")) return null
  return membership
}

export async function createExpenseClaimAction(workspaceId: string, formData: FormData): Promise<ActionState<{ id: string }>> {
  const user = await getCurrentUser()
  if (!(await requireExpenseClaimsMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  const title = String(formData.get("title") || "").trim()
  const documentIds = formData.getAll("documentIds").map(String).filter(Boolean)
  if (!documentIds.length) return { success: false, error: "Select at least one receipt" }
  try {
    const claim = await createExpenseClaim({ workspaceId, submitterId: user.id, title: title || null, documentIds })
    revalidatePath(paths(workspaceId).expenses)
    return { success: true, data: { id: claim.id } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not create the claim") } }
}

/** A draft can only be deleted by whoever submitted it, or a workspace owner — same "yours, or an
 * owner's call" bar as canCreateRule elsewhere, since a claim is personal until it's decided. */
export async function deleteExpenseClaimAction(workspaceId: string, claimId: string, submitterId: string | null): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  const membership = await requireExpenseClaimsMember(workspaceId, user.id)
  if (!membership) return { success: false, error: NO_ACCESS }
  if (submitterId !== user.id && membership.role !== "owner") return { success: false, error: NO_ACCESS }
  try {
    await deleteExpenseClaim(workspaceId, claimId)
    revalidatePath(paths(workspaceId).expenses)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not delete the claim") } }
}

/** "Yours, or an owner's call" — same bar as delete/submit, since a draft is still personal to
 * whoever's assembling it. */
export async function addExpenseClaimItemsAction(workspaceId: string, claimId: string, submitterId: string | null, documentIds: string[]): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  const membership = await requireExpenseClaimsMember(workspaceId, user.id)
  if (!membership) return { success: false, error: NO_ACCESS }
  if (submitterId !== user.id && membership.role !== "owner") return { success: false, error: NO_ACCESS }
  try {
    await addExpenseClaimItems(workspaceId, claimId, documentIds)
    revalidatePath(paths(workspaceId).expenses)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not add those receipts") } }
}

export async function removeExpenseClaimItemAction(workspaceId: string, claimId: string, submitterId: string | null, itemId: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  const membership = await requireExpenseClaimsMember(workspaceId, user.id)
  if (!membership) return { success: false, error: NO_ACCESS }
  if (submitterId !== user.id && membership.role !== "owner") return { success: false, error: NO_ACCESS }
  try {
    await removeExpenseClaimItem(workspaceId, claimId, itemId)
    revalidatePath(paths(workspaceId).expenses)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not remove that receipt") } }
}

export async function submitExpenseClaimAction(workspaceId: string, claimId: string, submitterId: string | null, workflowId: string | null): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  const membership = await requireExpenseClaimsMember(workspaceId, user.id)
  if (!membership) return { success: false, error: NO_ACCESS }
  if (submitterId !== user.id && membership.role !== "owner") return { success: false, error: NO_ACCESS }
  try {
    await submitExpenseClaim({ workspaceId, claimId, actorId: user.id, workflowId })
    revalidatePath(paths(workspaceId).expenses)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not submit the claim") } }
}

/** Deciding a claim — plain or workflow-staged — is never the submitter's own call: unlike
 * create/delete/submit, which are "this is your claim", a decision is someone else reviewing it.
 * Both decideExpenseClaimStage and updateExpenseClaimStatus already refuse the wrong claim state
 * on their own; this just picks which one applies. */
export async function decideExpenseClaimAction(workspaceId: string, claimId: string, hasWorkflow: boolean, decision: "approve" | "reject"): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  const membership = await requireExpenseClaimsMember(workspaceId, user.id)
  if (!membership) return { success: false, error: NO_ACCESS }
  const actorRole = membership.role === "owner" ? "owner" : "member"
  try {
    if (hasWorkflow) {
      await decideExpenseClaimStage({ workspaceId, claimId, decision, actorId: user.id, actorRole })
    } else {
      if (actorRole !== "owner") return { success: false, error: NO_ACCESS }
      await updateExpenseClaimStatus({ workspaceId, claimId, status: decision === "approve" ? "approved" : "rejected", actorId: user.id })
    }
    revalidatePath(paths(workspaceId).expenses)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not record that decision") } }
}
