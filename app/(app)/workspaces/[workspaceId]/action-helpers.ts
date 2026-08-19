// Deliberately NOT a "use server" module. A "use server" file may only export async functions,
// so `paths`, `NO_ACCESS` and friends cannot live in one — and both actions.ts and
// workspace-actions.ts need them. Extracting them here is the only way to share them.
import { requireWorkspaceRole } from "@/models/workspaces"

/** `documents` is only the detail-page prefix — there is no document list page; the sheet is
 * the view of that data, so document mutations revalidate the file's `sheet`. */
export const paths = (workspaceId: string) => ({ documents: `/workspaces/${workspaceId}/documents`, files: `/workspaces/${workspaceId}/files`, dictation: `/workspaces/${workspaceId}/dictation`, templates: `/workspaces/${workspaceId}/settings/templates`, reports: `/workspaces/${workspaceId}/settings/reports`, workspace: `/workspaces/${workspaceId}/settings/workspace`, billing: `/workspaces/${workspaceId}/settings/billing` })

export const sheetPath = (workspaceId: string, fileId: string) => `/workspaces/${workspaceId}/files/${fileId}/sheet`

/** Billing refusals, spelled out. The generic underscore-to-space fallback turns
 * "member_quota_exhausted" into "member quota exhausted", which tells the user what happened but
 * not what to do about it — and for the two that stop work outright ("trial_expired",
 * "subscription_inactive") that is the difference between a dead-end and a link they can act on.
 * Codes not listed here still fall through to the old behaviour. */
const BILLING_MESSAGES: Record<string, string> = {
  trial_expired: "Your free trial has ended — choose a plan in Billing & Usage to carry on.",
  subscription_inactive: "This workspace's subscription is not active. Update it in Billing & Usage to carry on.",
  document_quota_exhausted: "This workspace has used its document allowance for the period. Upgrade in Billing & Usage for more.",
  ai_quota_exhausted: "This workspace has used its AI allowance for the period. Upgrade in Billing & Usage for more.",
  member_quota_exhausted: "This workspace has no seats left on its plan. Upgrade in Billing & Usage to invite more people.",
  team_workspaces_require_upgrade: "Team workspaces need a plan with more than one seat. Upgrade in Billing & Usage.",
}

export const errorMessage = (error: unknown, fallback: string) => {
  if (!(error instanceof Error)) return fallback
  return BILLING_MESSAGES[error.message] || error.message.replaceAll("_", " ")
}

export const NO_ACCESS = "You no longer have access to this workspace"

/** requireWorkspaceRole throws on a missing membership or insufficient role. Actions call this
 * instead so the client gets an ActionState error to show, rather than a rejected promise. */
export async function requireMember(workspaceId: string, userId: string, roles?: Parameters<typeof requireWorkspaceRole>[2]) {
  try {
    return await requireWorkspaceRole(workspaceId, userId, roles)
  } catch {
    return null
  }
}
