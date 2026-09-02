"use server"

import { ActionState } from "@/lib/actions"
import { getCurrentUser } from "@/lib/auth"
import { executeRetryPush, executeVoidDuplicate, type RemediationOutcome } from "@/lib/health/actions"
import { ModuleNotEnabledError, requireModule } from "@/lib/modules/capabilities"
import { computeAndSnapshotHealthScore, dismissHealthFinding, resolveHealthFinding, runHealthChecks, undismissHealthFinding } from "@/models/health"
import { requireWorkspaceRole } from "@/models/workspaces"
import { revalidatePath } from "next/cache"
import { errorMessage, NO_ACCESS, requireMember } from "./action-helpers"

/** Every action here starts the same way: confirm membership (for the ActionState error path),
 * then requireModule — which throws ModuleNotEnabledError rather than returning a boolean, unlike
 * getWorkspaceCapabilities(...).has(...) elsewhere in this directory (see bank-match-actions.ts).
 * Caught below and turned into the same NO_ACCESS message a missing membership gets, since from
 * the caller's point of view both mean "you can't see this". */
async function requireHealthAccess(workspaceId: string): Promise<{ userId: string } | null> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return null
  try {
    await requireModule(workspaceId, "data-health")
  } catch (error) {
    if (error instanceof ModuleNotEnabledError) return null
    throw error
  }
  return { userId: user.id }
}

export async function dismissHealthFindingAction(workspaceId: string, findingId: string): Promise<ActionState<null>> {
  const access = await requireHealthAccess(workspaceId)
  if (!access) return { success: false, error: NO_ACCESS }
  try {
    await dismissHealthFinding({ workspaceId, findingId, actorId: access.userId })
    revalidatePath(`/workspaces/${workspaceId}/health`)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not dismiss that finding") } }
}

export async function undismissHealthFindingAction(workspaceId: string, findingId: string): Promise<ActionState<null>> {
  const access = await requireHealthAccess(workspaceId)
  if (!access) return { success: false, error: NO_ACCESS }
  try {
    await undismissHealthFinding({ workspaceId, findingId })
    revalidatePath(`/workspaces/${workspaceId}/health`)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not restore that finding") } }
}

export async function resolveHealthFindingAction(workspaceId: string, findingId: string): Promise<ActionState<null>> {
  const access = await requireHealthAccess(workspaceId)
  if (!access) return { success: false, error: NO_ACCESS }
  try {
    await resolveHealthFinding({ workspaceId, findingId, actorId: access.userId, action: "manual" })
    revalidatePath(`/workspaces/${workspaceId}/health`)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not resolve that finding") } }
}

/** "Run checks now" — a manual re-run of the same pass a scheduled job will eventually trigger.
 * Nothing in Phase A schedules that job yet; this action is the only way the checks run at all. */
export async function runHealthChecksAction(workspaceId: string): Promise<ActionState<null>> {
  const access = await requireHealthAccess(workspaceId)
  if (!access) return { success: false, error: NO_ACCESS }
  try {
    await runHealthChecks(workspaceId)
    await computeAndSnapshotHealthScore(workspaceId)
    revalidatePath(`/workspaces/${workspaceId}/health`)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not run health checks") } }
}

/** Phase C: remediation write-backs. Each one starts with requireModule (via requireHealthAccess)
 * AND, on top of that, requireWorkspaceRole(..., ["owner"]) — a member who can see the Health page
 * at all still cannot trigger a real write against someone's accounting books, only the workspace
 * owner can. requireWorkspaceRole throws on a non-owner, which is caught below into the same
 * NO_ACCESS an unmet module gate gets, so a non-owner sees "no access" rather than a stack trace. */
async function requireHealthOwnerAccess(workspaceId: string): Promise<{ userId: string } | null> {
  const access = await requireHealthAccess(workspaceId)
  if (!access) return null
  try {
    await requireWorkspaceRole(workspaceId, access.userId, ["owner"])
  } catch {
    return null
  }
  return access
}

export type RemediationActionState = ActionState<RemediationOutcome>

/** dryRun defaults to true — a caller must explicitly pass dryRun: false to perform the real,
 * irreversible write. The UI (components/health/finding-card.tsx) always calls with dryRun: true
 * first and only calls again with dryRun: false after a person clicks a second, distinct Confirm
 * button, per the two-step UI rule in the Phase C brief. */
export async function voidDuplicateAction(workspaceId: string, findingId: string, dryRun: boolean = true): Promise<RemediationActionState> {
  const access = await requireHealthOwnerAccess(workspaceId)
  if (!access) return { success: false, error: NO_ACCESS }
  try {
    const outcome = await executeVoidDuplicate({ workspaceId, findingId, actorId: access.userId, dryRun })
    if (!dryRun) revalidatePath(`/workspaces/${workspaceId}/health`)
    return { success: true, data: outcome }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not void that duplicate bill") } }
}

export async function retryPushAction(workspaceId: string, findingId: string, dryRun: boolean = true): Promise<RemediationActionState> {
  const access = await requireHealthOwnerAccess(workspaceId)
  if (!access) return { success: false, error: NO_ACCESS }
  try {
    const outcome = await executeRetryPush({ workspaceId, findingId, actorId: access.userId, dryRun })
    if (!dryRun) revalidatePath(`/workspaces/${workspaceId}/health`)
    return { success: true, data: outcome }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not retry that push") } }
}
