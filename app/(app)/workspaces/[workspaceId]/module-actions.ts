"use server"

import { ActionState } from "@/lib/actions"
import { getCurrentUser } from "@/lib/auth"
import { findModule } from "@/lib/modules"
import { revalidatePath } from "next/cache"
import { setModuleState } from "@/models/modules"
import { errorMessage, NO_ACCESS, paths, requireMember, revalidateWorkspaceLayout } from "./action-helpers"

/** Modules-catalog actions: owners enable/disable a default or optional module; any member may
 * request an optional "request"-tier module instead of turning it on themselves. Kept out of
 * actions.ts for the same audit-surface reason dictation-actions.ts/review-actions.ts are. */

export async function enableModuleAction(workspaceId: string, moduleKey: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  const membership = await requireMember(workspaceId, user.id, ["owner"])
  if (!membership) return { success: false, error: NO_ACCESS }
  const mod = findModule(moduleKey)
  if (!mod || mod.tier === "always") return { success: false, error: "That module can't be toggled." }
  try {
    await setModuleState({ workspaceId, moduleKey, status: "enabled", actorId: user.id })
    revalidatePath(paths(workspaceId).modules)
    revalidateWorkspaceLayout()
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not enable that module") } }
}

export async function disableModuleAction(workspaceId: string, moduleKey: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  const membership = await requireMember(workspaceId, user.id, ["owner"])
  if (!membership) return { success: false, error: NO_ACCESS }
  const mod = findModule(moduleKey)
  if (!mod || mod.tier === "always") return { success: false, error: "That module can't be turned off." }
  try {
    await setModuleState({ workspaceId, moduleKey, status: "disabled", actorId: user.id })
    revalidatePath(paths(workspaceId).modules)
    revalidateWorkspaceLayout()
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not turn off that module") } }
}

/** Any member (not just an owner) may ask for a request-tier module — this creates a "requested"
 * row for the catalog to badge, but grants no capability by itself (resolveModules ignores it);
 * an owner still has to actually enable it. */
export async function requestModuleAction(workspaceId: string, moduleKey: string, note?: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  const membership = await requireMember(workspaceId, user.id)
  if (!membership) return { success: false, error: NO_ACCESS }
  const mod = findModule(moduleKey)
  if (!mod || mod.activation !== "request") return { success: false, error: "That module isn't requestable." }
  try {
    await setModuleState({ workspaceId, moduleKey, status: "requested", actorId: user.id, note })
    revalidatePath(paths(workspaceId).modules)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not send that request") } }
}
