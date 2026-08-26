// Deliberately NOT a "use server" module. A "use server" file may only export async functions,
// so `paths`, `NO_ACCESS` and friends cannot live in one — and both actions.ts and
// workspace-actions.ts need them. Extracting them here is the only way to share them.
import { requireWorkspaceRole } from "@/models/workspaces"

/** `documents` is only the detail-page prefix — there is no document list page; the sheet is
 * the view of that data, so document mutations revalidate the file's `sheet`. */
export const paths = (workspaceId: string) => ({ documents: `/workspaces/${workspaceId}/documents`, files: `/workspaces/${workspaceId}/files`, dictation: `/workspaces/${workspaceId}/dictation`, templates: `/workspaces/${workspaceId}/settings/templates`, reports: `/workspaces/${workspaceId}/settings/reports`, workspace: `/workspaces/${workspaceId}/settings/workspace`, billing: `/workspaces/${workspaceId}/settings/billing`, integrations: `/workspaces/${workspaceId}/settings/integrations` })

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
  // Integrations (P1). The url_* codes come from lib/url-safety's SSRF guard.
  integrations_not_available: "Integrations aren't enabled on this deployment.",
  integrations_plan_required: "Webhooks and the API are available on a paid plan. Upgrade in Billing & Usage.",
  url_scheme_not_https: "The webhook URL must start with https://.",
  url_private_ip: "That URL points at a private or internal address, which isn't allowed.",
  url_invalid: "That doesn't look like a valid URL.",
  url_has_credentials: "Remove the username and password from the URL.",
  url_dns_failed: "That host couldn't be resolved. Check the URL and try again.",
  invalid_event_type: "One of the selected events isn't recognised.",
  api_key_not_found: "That API key no longer exists.",
  webhook_endpoint_not_found: "That webhook endpoint no longer exists.",
  delivery_not_found: "That delivery no longer exists.",
  // Accounting connectors (P2).
  integration_connection_not_found: "That connection no longer exists.",
  bill_missing_total: "This document has no total to push.",
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
