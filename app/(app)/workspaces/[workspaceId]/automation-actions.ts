"use server"

import { ActionState } from "@/lib/actions"
import type { RuleMatcherType } from "@/lib/automation/rules"
import { getCurrentUser } from "@/lib/auth"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { createAutomationRule, updateAutomationRule } from "@/models/automation-rules"
import { revalidatePath } from "next/cache"
import { errorMessage, NO_ACCESS, paths, requireMember } from "./action-helpers"

async function requireAccountingOwner(workspaceId: string, userId: string) {
  const membership = await requireMember(workspaceId, userId, ["owner"])
  if (!membership) return null
  if (!(await getWorkspaceCapabilities(workspaceId)).has("supplier-rules")) return null
  return membership
}

export async function createAutomationRuleAction(workspaceId: string, formData: FormData): Promise<ActionState<{ id: string }>> {
  const user = await getCurrentUser()
  if (!(await requireAccountingOwner(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  const name = String(formData.get("name") || "").trim()
  const matcherType = String(formData.get("matcherType") || "exact") as RuleMatcherType
  const matcherValue = String(formData.get("matcherValue") || "").trim()
  const account = String(formData.get("account") || "").trim()
  const requireReview = formData.get("requireReview") === "on"
  if (!matcherValue) return { success: false, error: "Enter a supplier name to match" }
  if (!account) return { success: false, error: "Enter an account code to assign" }
  try {
    const rule = await createAutomationRule({
      workspaceId, name: name || matcherValue,
      matcher: { type: matcherType === "contains" ? "contains" : "exact", value: matcherValue },
      actions: { codingData: { account } },
      requireReview, createdById: user.id,
    })
    revalidatePath(paths(workspaceId).rules)
    return { success: true, data: { id: rule.id } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not create the rule") } }
}

export async function setAutomationRuleActiveAction(workspaceId: string, ruleId: string, isActive: boolean): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireAccountingOwner(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    await updateAutomationRule({ workspaceId, ruleId, actorId: user.id, isActive })
    revalidatePath(paths(workspaceId).rules)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not update the rule") } }
}
