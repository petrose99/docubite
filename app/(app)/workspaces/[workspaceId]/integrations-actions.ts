"use server"

/** Server actions for the integrations settings page: minting/revoking API keys, registering and
 * toggling webhook endpoints, and requesting a redelivery. Kept in their own file (the report-actions
 * precedent) because they are the security surface for outbound integrations — every one is
 * owner-gated, deployment-gated (config.integrations.enabled) and plan-gated, in that order. */

import { ActionState } from "@/lib/actions"
import { recordDocumentAudit } from "@/lib/audit"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { UnsafeUrlError } from "@/lib/url-safety"
import { kickWebhookDrain } from "@/lib/webhook-delivery"
import {
  createWorkspaceApiKey,
  createWorkspaceWebhookEndpoint,
  deleteWorkspaceWebhookEndpoint,
  redeliverWorkspaceWebhookDelivery,
  revokeWorkspaceApiKey,
  setWorkspaceWebhookEndpointStatus,
  workspaceIntegrationsPlanEnabled,
} from "@/models/integrations"
import { revalidatePath } from "next/cache"
import { errorMessage, NO_ACCESS, paths, requireMember } from "./action-helpers"

/** The common gate: deployment on → owner → plan includes integrations. Returns the acting user's id
 * on success, or an error code string to return straight to the client. */
async function guardIntegrations(workspaceId: string): Promise<{ userId: string } | { error: string }> {
  if (!config.integrations.enabled) return { error: "integrations_not_available" }
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { error: NO_ACCESS }
  if (!(await workspaceIntegrationsPlanEnabled(workspaceId))) return { error: "integrations_plan_required" }
  return { userId: user.id }
}

export async function createApiKeyAction(workspaceId: string, name: string): Promise<ActionState<{ id: string; plaintext: string; keyPrefix: string }>> {
  const gate = await guardIntegrations(workspaceId)
  if ("error" in gate) return { success: false, error: errorMessage(new Error(gate.error), NO_ACCESS) }
  try {
    const { plaintext, record } = await createWorkspaceApiKey(workspaceId, { name, createdById: gate.userId })
    await recordDocumentAudit({ workspaceId, actorId: gate.userId, type: "api_key_created", detail: { keyId: record.id, keyPrefix: record.keyPrefix } })
    revalidatePath(paths(workspaceId).integrations)
    return { success: true, data: { id: record.id, plaintext, keyPrefix: record.keyPrefix } }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not create the API key") }
  }
}

export async function revokeApiKeyAction(workspaceId: string, keyId: string): Promise<ActionState> {
  const gate = await guardIntegrations(workspaceId)
  if ("error" in gate) return { success: false, error: errorMessage(new Error(gate.error), NO_ACCESS) }
  try {
    await revokeWorkspaceApiKey(workspaceId, keyId)
    await recordDocumentAudit({ workspaceId, actorId: gate.userId, type: "api_key_revoked", detail: { keyId } })
    revalidatePath(paths(workspaceId).integrations)
    return { success: true }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not revoke the API key") }
  }
}

export async function createWebhookEndpointAction(workspaceId: string, url: string, events: string[]): Promise<ActionState<{ id: string; secret: string; url: string }>> {
  const gate = await guardIntegrations(workspaceId)
  if ("error" in gate) return { success: false, error: errorMessage(new Error(gate.error), NO_ACCESS) }
  try {
    const { secret, endpoint } = await createWorkspaceWebhookEndpoint(workspaceId, { url, events, createdById: gate.userId })
    await recordDocumentAudit({ workspaceId, actorId: gate.userId, type: "webhook_endpoint_created", detail: { endpointId: endpoint.id, url: endpoint.url } })
    revalidatePath(paths(workspaceId).integrations)
    return { success: true, data: { id: endpoint.id, secret, url: endpoint.url } }
  } catch (error) {
    if (error instanceof UnsafeUrlError) return { success: false, error: errorMessage(new Error(error.code), "That webhook URL isn't allowed") }
    return { success: false, error: errorMessage(error, "Could not register the webhook") }
  }
}

export async function setWebhookEndpointStatusAction(workspaceId: string, endpointId: string, status: "active" | "disabled"): Promise<ActionState> {
  const gate = await guardIntegrations(workspaceId)
  if ("error" in gate) return { success: false, error: errorMessage(new Error(gate.error), NO_ACCESS) }
  try {
    await setWorkspaceWebhookEndpointStatus(workspaceId, endpointId, status)
    await recordDocumentAudit({ workspaceId, actorId: gate.userId, type: status === "active" ? "webhook_endpoint_enabled" : "webhook_endpoint_disabled", detail: { endpointId } })
    revalidatePath(paths(workspaceId).integrations)
    return { success: true }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not update the webhook") }
  }
}

export async function deleteWebhookEndpointAction(workspaceId: string, endpointId: string): Promise<ActionState> {
  const gate = await guardIntegrations(workspaceId)
  if ("error" in gate) return { success: false, error: errorMessage(new Error(gate.error), NO_ACCESS) }
  try {
    await deleteWorkspaceWebhookEndpoint(workspaceId, endpointId)
    await recordDocumentAudit({ workspaceId, actorId: gate.userId, type: "webhook_endpoint_deleted", detail: { endpointId } })
    revalidatePath(paths(workspaceId).integrations)
    return { success: true }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not delete the webhook") }
  }
}

export async function redeliverDeliveryAction(workspaceId: string, deliveryId: string): Promise<ActionState> {
  const gate = await guardIntegrations(workspaceId)
  if ("error" in gate) return { success: false, error: errorMessage(new Error(gate.error), NO_ACCESS) }
  try {
    await redeliverWorkspaceWebhookDelivery(workspaceId, deliveryId)
    await kickWebhookDrain()
    revalidatePath(paths(workspaceId).integrations)
    return { success: true }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not redeliver") }
  }
}
