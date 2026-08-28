"use server"

import { ActionState } from "@/lib/actions"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { isEmailConfigured, sendWorkspaceInvitationEmail } from "@/lib/email"
import {
  createTeamWorkspace,
  createWorkspaceInvitation,
  deleteWorkspace,
  leaveWorkspace,
  removeWorkspaceMember,
  renameWorkspace,
  revokeWorkspaceInvitation,
  transferWorkspaceOwnership,
  updateWorkspaceMemberRole,
  WorkspaceRole,
} from "@/models/workspaces"
import { parseIndustry } from "@/types/industry"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { errorMessage, NO_ACCESS, paths, requireMember } from "./action-helpers"

/** The switcher's workspace list is rendered by the segment *layout*
 * (app/(app)/workspaces/[workspaceId]/layout.tsx), and revalidatePath on a concrete path only
 * invalidates the page segment. Without the "layout" variant a rename updates the settings page
 * and leaves a stale name in the sidebar until a hard reload. */
const revalidateWorkspaceLayout = () => revalidatePath("/workspaces/[workspaceId]", "layout")

const inviteUrlFor = (token: string) => `${config.app.baseURL}/invite/${token}`

/** Sends the invitation and reports whether it actually went out. With a placeholder Resend key
 * the send is skipped rather than attempted — a 401 from Resend would look like a real failure
 * and cost the owner their copyable link, which is the whole fallback in development.
 * Awaited rather than deferred with after() so `emailed` is truthful by the time the UI reads it. */
async function deliverInvitation(input: { email: string; workspaceName: string; inviterName: string; token: string; expiresAt: Date }) {
  if (!isEmailConfigured()) return false
  try {
    await sendWorkspaceInvitationEmail({ email: input.email, workspaceName: input.workspaceName, inviterName: input.inviterName, inviteUrl: inviteUrlFor(input.token), expiresAt: input.expiresAt })
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------- create, rename, delete --- */

/** Any member may create a workspace; createTeamWorkspace itself is what gates it on the
 * strongest plan the user owns, so the upsell cannot be clicked past. */
export async function createWorkspaceAction(name: string, industry?: string): Promise<ActionState<{ workspaceId: string }>> {
  const user = await getCurrentUser()
  if (!name.trim()) return { success: false, error: "Enter a workspace name" }
  // Absent/unrecognised falls through to createWorkspaceForUser's own "finance" default —
  // this is the one chance to set it, not a value worth hard-failing the whole creation over.
  const parsedMode = parseIndustry(industry) ?? undefined
  try {
    const workspace = await createTeamWorkspace(user, name, parsedMode)
    revalidateWorkspaceLayout()
    return { success: true, data: { workspaceId: workspace.id } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not create the workspace") } }
}

export async function renameWorkspaceAction(workspaceId: string, name: string): Promise<ActionState<{ name: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  try {
    const workspace = await renameWorkspace(workspaceId, name)
    revalidatePath(paths(workspaceId).workspace)
    revalidateWorkspaceLayout()
    return { success: true, data: { name: workspace.name } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not rename the workspace") } }
}

/** No redirect() here, and none in leaveWorkspaceAction. The moment the membership is gone the
 * segment layout redirects and (chrome)/layout.tsx's requireWorkspaceRole *throws* into
 * error.tsx, so a server redirect would race the teardown of the very tree it is running in.
 * The client does a hard `window.location.href = "/workspaces"` instead — same reasoning as the
 * sign-out in components/shell/account-menu.tsx. */
export async function deleteWorkspaceAction(workspaceId: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  try {
    await deleteWorkspace({ workspaceId, actorId: user.id })
    revalidatePath("/workspaces", "layout")
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not delete the workspace") } }
}

export async function leaveWorkspaceAction(workspaceId: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    await leaveWorkspace(workspaceId, user.id)
    revalidatePath("/workspaces", "layout")
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not leave the workspace") } }
}

/* ------------------------------------------------------------------------- membership --- */

export async function removeWorkspaceMemberAction(workspaceId: string, memberUserId: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  try {
    await removeWorkspaceMember({ workspaceId, actorId: user.id, memberUserId })
    revalidatePath(paths(workspaceId).workspace)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not remove the member") } }
}

export async function changeWorkspaceMemberRoleAction(workspaceId: string, memberUserId: string, role: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  if (role !== "owner" && role !== "member") return { success: false, error: "Choose a valid role" }
  try {
    await updateWorkspaceMemberRole({ workspaceId, memberUserId, role: role as WorkspaceRole })
    revalidatePath(paths(workspaceId).workspace)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not change the role") } }
}

export async function transferWorkspaceOwnershipAction(workspaceId: string, targetUserId: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  try {
    await transferWorkspaceOwnership({ workspaceId, actorId: user.id, targetUserId })
    // No role re-check after this point: the actor has just stepped down to plain member, so
    // asserting ["owner"] again would fail on their own successful transfer.
    revalidatePath(paths(workspaceId).workspace)
    revalidateWorkspaceLayout()
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not transfer ownership") } }
}

/* ------------------------------------------------------------------------ invitations --- */

export async function inviteWorkspaceMemberAction(workspaceId: string, formData: FormData): Promise<ActionState<{ inviteUrl: string; emailed: boolean }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  const email = String(formData.get("email") || "").trim()
  const role = String(formData.get("role") || "member")
  if (!z.string().email().safeParse(email).success) return { success: false, error: "Enter a valid email" }
  try {
    const { token, invitation, workspaceName } = await createWorkspaceInvitation({ workspaceId, ownerId: user.id, email, role: role === "owner" ? "owner" : "member" })
    const emailed = await deliverInvitation({ email: invitation.email, workspaceName, inviterName: user.name || user.email, token, expiresAt: invitation.expiresAt })
    revalidatePath(paths(workspaceId).workspace)
    return { success: true, data: { inviteUrl: inviteUrlFor(token), emailed } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not create invitation") } }
}

/** Re-issuing rotates the token, which invalidates the previous link — createWorkspaceInvitation
 * deletes the pending row for this email before writing the new one. */
export async function resendWorkspaceInvitationAction(workspaceId: string, email: string, role: string): Promise<ActionState<{ inviteUrl: string; emailed: boolean }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  try {
    const { token, invitation, workspaceName } = await createWorkspaceInvitation({ workspaceId, ownerId: user.id, email, role: role === "owner" ? "owner" : "member" })
    const emailed = await deliverInvitation({ email: invitation.email, workspaceName, inviterName: user.name || user.email, token, expiresAt: invitation.expiresAt })
    revalidatePath(paths(workspaceId).workspace)
    return { success: true, data: { inviteUrl: inviteUrlFor(token), emailed } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not resend the invitation") } }
}

export async function revokeWorkspaceInvitationAction(workspaceId: string, invitationId: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  try {
    const { count } = await revokeWorkspaceInvitation(workspaceId, invitationId)
    if (!count) return { success: false, error: "Invitation not found" }
    revalidatePath(paths(workspaceId).workspace)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not revoke the invitation") } }
}
