"use server"

/** Server actions for managing accounting connections (P2): listing, setting the default expense
 * account (which requires a live provider call to list accounts), and disconnecting. Same owner +
 * deployment + plan gate as app/(app)/workspaces/[workspaceId]/integrations-actions.ts, reused here
 * rather than duplicated. */

import { ActionState } from "@/lib/actions"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { getValidAccessToken, TokenRefreshError } from "@/lib/integration-token-refresh"
import { listExpenseAccounts as listQuickbooksAccounts } from "@/lib/integrations/quickbooks/client"
import { listExpenseAccounts as listXeroAccounts } from "@/lib/integrations/xero/client"
import {
  deleteWorkspaceIntegrationConnection,
  listWorkspaceIntegrationConnections,
  setWorkspaceIntegrationDefaultAccount,
  workspaceIntegrationsPlanEnabled,
} from "@/models/integrations"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { errorMessage, NO_ACCESS, paths, requireMember } from "./action-helpers"

async function guardIntegrations(workspaceId: string): Promise<{ userId: string } | { error: string }> {
  if (!config.integrations.enabled) return { error: "integrations_not_available" }
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { error: NO_ACCESS }
  if (!(await workspaceIntegrationsPlanEnabled(workspaceId))) return { error: "integrations_plan_required" }
  return { userId: user.id }
}

export async function listIntegrationConnectionsAction(workspaceId: string) {
  return listWorkspaceIntegrationConnections(workspaceId)
}

/** Fetches the live list of expense accounts from the provider (for the settings UI's default-
 * account <select>) — not cached, since the workspace's chart of accounts can change at the
 * provider at any time and this is only called when the owner opens the picker. */
export async function listExpenseAccountsAction(workspaceId: string, connectionId: string): Promise<ActionState<{ id: string; name: string }[]>> {
  const gate = await guardIntegrations(workspaceId)
  if ("error" in gate) return { success: false, error: errorMessage(new Error(gate.error), NO_ACCESS) }
  try {
    const connection = await prisma.integrationConnection.findFirst({
      where: { id: connectionId, workspaceId },
      select: { id: true, provider: true, externalTenantId: true },
    })
    if (!connection || !connection.externalTenantId) return { success: false, error: "That connection no longer exists" }
    const accessToken = await getValidAccessToken(connection.id)
    const accounts = connection.provider === "quickbooks"
      ? await listQuickbooksAccounts(connection.externalTenantId, accessToken)
      : (await listXeroAccounts(connection.externalTenantId, accessToken)).map((a) => ({ id: a.code, name: a.name }))
    return { success: true, data: accounts }
  } catch (error) {
    if (error instanceof TokenRefreshError && error.message === "integration_needs_reauth") {
      return { success: false, error: "This connection needs to be reconnected before its accounts can be listed" }
    }
    return { success: false, error: errorMessage(error, "Could not list expense accounts") }
  }
}

export async function setDefaultExpenseAccountAction(workspaceId: string, connectionId: string, accountId: string, accountName: string): Promise<ActionState> {
  const gate = await guardIntegrations(workspaceId)
  if ("error" in gate) return { success: false, error: errorMessage(new Error(gate.error), NO_ACCESS) }
  try {
    await setWorkspaceIntegrationDefaultAccount(workspaceId, connectionId, { id: accountId, name: accountName })
    revalidatePath(paths(workspaceId).integrations)
    return { success: true }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not set the default expense account") }
  }
}

export async function disconnectIntegrationAction(workspaceId: string, connectionId: string): Promise<ActionState> {
  const gate = await guardIntegrations(workspaceId)
  if ("error" in gate) return { success: false, error: errorMessage(new Error(gate.error), NO_ACCESS) }
  try {
    await deleteWorkspaceIntegrationConnection(workspaceId, connectionId)
    revalidatePath(paths(workspaceId).integrations)
    return { success: true }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not disconnect") }
  }
}
