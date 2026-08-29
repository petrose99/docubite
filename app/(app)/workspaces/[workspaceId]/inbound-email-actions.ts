"use server"

import { ActionState } from "@/lib/actions"
import { getCurrentUser } from "@/lib/auth"
import { addAllowedSender, ensureInboundEmailToken, removeAllowedSender } from "@/models/inbound-email"
import { revalidatePath } from "next/cache"
import { errorMessage, NO_ACCESS, paths, requireMember } from "./action-helpers"

export async function ensureInboundEmailTokenAction(workspaceId: string): Promise<ActionState<{ token: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  try {
    const token = await ensureInboundEmailToken(workspaceId)
    return { success: true, data: { token } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not set up an inbound email address") } }
}

export async function addAllowedSenderAction(workspaceId: string, formData: FormData): Promise<ActionState<{ id: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  const pattern = String(formData.get("pattern") || "").trim()
  if (!pattern) return { success: false, error: "Enter an email address or @domain" }
  try {
    const row = await addAllowedSender({ workspaceId, pattern, createdById: user.id })
    revalidatePath(paths(workspaceId).settingsEmail)
    return { success: true, data: { id: row.id } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not add that sender") } }
}

export async function removeAllowedSenderAction(workspaceId: string, id: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  try {
    await removeAllowedSender({ workspaceId, id, actorId: user.id })
    revalidatePath(paths(workspaceId).settingsEmail)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not remove that sender") } }
}
