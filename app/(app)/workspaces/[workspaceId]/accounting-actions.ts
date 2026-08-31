"use server"

/** Server actions for the Accounting tab's Bigcapital connection card: re-provisioning (first
 * attempt or repair after a failure). Everything else the tab needs — sync now, default account
 * picker, disconnect — is already provider-agnostic in integration-connection-actions.ts and is
 * reused there rather than duplicated. */

import { ActionState } from "@/lib/actions"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { enqueueBigcapitalProvisionJob, getWorkspaceProvisionJob } from "@/models/bigcapital"
import { getWorkspaceIntegrationConnection } from "@/models/integrations"
import { revalidatePath } from "next/cache"
import { errorMessage, NO_ACCESS, paths, requireMember } from "./action-helpers"

async function guardAccounting(workspaceId: string): Promise<{ userId: string } | { error: string }> {
  if (!config.integrations.bigcapital.enabled) return { error: "accounting_not_available" }
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { error: NO_ACCESS }
  return { userId: user.id }
}

export async function getBigcapitalStatusAction(workspaceId: string) {
  const [connection, job] = await Promise.all([
    getWorkspaceIntegrationConnection(workspaceId, "bigcapital"),
    getWorkspaceProvisionJob(workspaceId),
  ])
  return { connection, job }
}

/** Starts (or restarts, after a failure) provisioning this workspace's Bigcapital organization. Idempotent:
 * re-running it while a job is already pending/succeeded just resets the same row to a fresh attempt cycle. */
export async function repairBigcapitalConnectionAction(workspaceId: string): Promise<ActionState> {
  const gate = await guardAccounting(workspaceId)
  if ("error" in gate) return { success: false, error: errorMessage(new Error(gate.error), NO_ACCESS) }
  try {
    await enqueueBigcapitalProvisionJob(workspaceId, gate.userId)
    revalidatePath(paths(workspaceId).accounting)
    return { success: true }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not start provisioning") }
  }
}
