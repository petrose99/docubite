"use server"

import { ActionState } from "@/lib/actions"
import { TAX_REGION_CODES } from "@/lib/tax/types"
import { setTaxRegion } from "@/models/tax-profiles"
import { getCurrentUser } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { NO_ACCESS, paths, requireMember } from "./action-helpers"

export async function setTaxRegionAction(workspaceId: string, region: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  const membership = await requireMember(workspaceId, user.id, ["owner"])
  if (!membership) return { success: false, error: NO_ACCESS }
  if (membership.workspace.productMode !== "accounting") return { success: false, error: "Tax settings are only available in an accounting-mode workspace." }
  if (!TAX_REGION_CODES.includes(region as (typeof TAX_REGION_CODES)[number])) return { success: false, error: "Unknown tax region" }

  try {
    await setTaxRegion(workspaceId, region as (typeof TAX_REGION_CODES)[number])
    revalidatePath(paths(workspaceId).tax)
    return { success: true, data: null }
  } catch {
    return { success: false, error: "Could not change the tax region" }
  }
}
