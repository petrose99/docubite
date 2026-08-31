"use server"

/** Server action for pushing a reviewed document to a connected accounting provider as a bill. One
 * upsert of the queue row, then an inline (awaited) attempt so the acting user sees the outcome
 * immediately — a kick of the drain covers the case where the inline attempt itself leaves the row
 * pending (rare, but the drain is the correctness guarantee either way, exactly as
 * redeliverDeliveryAction kicks the webhook drain). */

import { ActionState } from "@/lib/actions"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { BillMappingError, normalizeBillFromDocument } from "@/lib/integration-bill-mapping"
import { attemptIntegrationPush, kickIntegrationPushDrain } from "@/lib/integration-push"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { getWorkspaceDocument } from "@/models/documents"
import { upsertWorkspaceIntegrationPush, workspaceIntegrationsPlanEnabled } from "@/models/integrations"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { errorMessage, NO_ACCESS, requireMember } from "./action-helpers"

export async function pushDocumentToAccountingAction(
  workspaceId: string,
  documentId: string,
  connectionId: string
): Promise<ActionState<{ status: string }>> {
  if (!config.integrations.enabled) return { success: false, error: errorMessage(new Error("integrations_not_available"), NO_ACCESS) }
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  if (!(await workspaceIntegrationsPlanEnabled(workspaceId))) return { success: false, error: errorMessage(new Error("integrations_plan_required"), NO_ACCESS) }

  try {
    const document = await getWorkspaceDocument(workspaceId, documentId)
    if (!document) return { success: false, error: "Document not found" }
    if (document.status !== "reviewed") return { success: false, error: "Only reviewed documents can be pushed" }
    const templateCode = document.template?.code ?? null
    const { pushableTemplateCodes } = await getWorkspaceCapabilities(workspaceId)
    if (!templateCode || !pushableTemplateCodes.includes(templateCode)) {
      return { success: false, error: "This document's type can't be pushed to accounting" }
    }
    const connection = await prisma.integrationConnection.findFirst({ where: { id: connectionId, workspaceId }, select: { id: true, provider: true } })
    if (!connection) return { success: false, error: "That connection no longer exists" }

    const reviewedData = (document.reviewedData as Record<string, unknown> | null) ?? (document.rawExtraction as Record<string, unknown> | null) ?? {}
    const bill = normalizeBillFromDocument({ documentId: document.id, filename: document.filename, templateCode, reviewedData })

    const push = await upsertWorkspaceIntegrationPush(workspaceId, {
      connectionId: connection.id,
      documentId: document.id,
      provider: connection.provider as "quickbooks" | "xero" | "bigcapital",
      payload: bill,
      createdById: user.id,
    })
    await attemptIntegrationPush(push.id)
    const updated = await prisma.integrationPush.findUnique({ where: { id: push.id }, select: { status: true } })
    if (updated?.status === "pending") await kickIntegrationPushDrain()
    revalidatePath(`/workspaces/${workspaceId}/documents/${documentId}`)
    return { success: true, data: { status: updated?.status ?? "pending" } }
  } catch (error) {
    if (error instanceof BillMappingError) return { success: false, error: "This document has no total to push" }
    return { success: false, error: errorMessage(error, "Could not push this document") }
  }
}

export async function listDocumentPushesAction(workspaceId: string, documentId: string) {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return []
  return prisma.integrationPush.findMany({
    where: { workspaceId, documentId },
    orderBy: { createdAt: "desc" },
    select: { id: true, connectionId: true, provider: true, status: true, attempts: true, externalBillId: true, errorCode: true, completedAt: true },
  })
}
