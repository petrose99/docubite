"use server"

/** Server action for pushing a reviewed document to a connected accounting provider as a bill. One
 * upsert of the queue row, then an inline (awaited) attempt so the acting user sees the outcome
 * immediately — a kick of the drain covers the case where the inline attempt itself leaves the row
 * pending (rare, but the drain is the correctness guarantee either way, exactly as
 * redeliverDeliveryAction kicks the webhook drain). */

import { ActionState } from "@/lib/actions"
import { recordDocumentAudit } from "@/lib/audit"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { BillMappingError, normalizeBillFromDocument } from "@/lib/integration-bill-mapping"
import { attemptIntegrationPush, kickIntegrationPushDrain } from "@/lib/integration-push"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { getWorkspaceDocument, listReadyToPushDocuments } from "@/models/documents"
import { upsertWorkspaceIntegrationPush, workspaceIntegrationsPlanEnabled } from "@/models/integrations"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { errorMessage, NO_ACCESS, requireMember } from "./action-helpers"

/** Core push logic shared by the single-document action and the "Push all" batch action: resolves
 * the document + connection, upserts the push row, and runs one inline attempt. Auth/plan checks
 * are the caller's job — the batch caller checks them once for the whole run rather than once per
 * document. */
async function pushDocumentToConnection(
  workspaceId: string,
  documentId: string,
  connectionId: string,
  userId: string,
  expenseAccountId?: string
): Promise<{ status: string }> {
  const document = await getWorkspaceDocument(workspaceId, documentId)
  if (!document) throw new Error("Document not found")
  if (document.status !== "reviewed") throw new Error("Only reviewed documents can be pushed")
  const templateCode = document.template?.code ?? null
  const { pushableTemplateCodes } = await getWorkspaceCapabilities(workspaceId)
  if (!templateCode || !pushableTemplateCodes.includes(templateCode)) {
    throw new Error("This document's type can't be pushed to accounting")
  }
  const connection = await prisma.integrationConnection.findFirst({ where: { id: connectionId, workspaceId }, select: { id: true, provider: true } })
  if (!connection) throw new Error("That connection no longer exists")

  const reviewedData = (document.reviewedData as Record<string, unknown> | null) ?? (document.rawExtraction as Record<string, unknown> | null) ?? {}
  const bill = normalizeBillFromDocument({ documentId: document.id, filename: document.filename, templateCode, reviewedData })
  const coding = (document.codingData as Record<string, unknown> | null) ?? {}
  const category = (typeof coding.account === "string" && coding.account) || (typeof reviewedData.category === "string" && reviewedData.category) || null
  const documentType = coding.documentType === "expense" || coding.documentType === "sale" ? coding.documentType : "expense"
  const payload = { ...bill, documentType, ...(expenseAccountId ? { expenseAccountId } : {}), ...(category ? { category } : {}) }

  const push = await upsertWorkspaceIntegrationPush(workspaceId, {
    connectionId: connection.id,
    documentId: document.id,
    provider: connection.provider as "quickbooks" | "xero" | "bigcapital",
    payload,
    createdById: userId,
  })
  await attemptIntegrationPush(push.id)
  const updated = await prisma.integrationPush.findUnique({ where: { id: push.id }, select: { status: true } })
  if (updated?.status === "pending") await kickIntegrationPushDrain()
  return { status: updated?.status ?? "pending" }
}

export async function pushDocumentToAccountingAction(
  workspaceId: string,
  documentId: string,
  connectionId: string,
  expenseAccountId?: string
): Promise<ActionState<{ status: string }>> {
  if (!config.integrations.enabled) return { success: false, error: errorMessage(new Error("integrations_not_available"), NO_ACCESS) }
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  if (!(await workspaceIntegrationsPlanEnabled(workspaceId))) return { success: false, error: errorMessage(new Error("integrations_plan_required"), NO_ACCESS) }

  try {
    const result = await pushDocumentToConnection(workspaceId, documentId, connectionId, user.id, expenseAccountId)
    await recordDocumentAudit({ workspaceId, actorId: user.id, documentId, type: "integration_push_enqueued", detail: { connectionId } })
    revalidatePath(`/workspaces/${workspaceId}/documents/${documentId}`)
    revalidatePath(`/workspaces/${workspaceId}/accounting`)
    return { success: true, data: result }
  } catch (error) {
    if (error instanceof BillMappingError) return { success: false, error: "This document has no total to push" }
    return { success: false, error: errorMessage(error, "Could not push this document") }
  }
}

/** Batch counterpart to pushDocumentToAccountingAction: resolves the "ready to push" set
 * server-side (never trusts a client-supplied document list) and pushes each one in turn through
 * the same upsert-per-(document,connection) path, so re-running the whole batch is exactly as
 * idempotent as retrying one document — a document that already succeeded simply won't be in the
 * ready set next time. */
export async function pushAllReadyDocumentsAction(
  workspaceId: string,
  connectionId: string,
  accountOverrides?: Record<string, string>
): Promise<ActionState<{ pushed: number; failed: number }>> {
  if (!config.integrations.enabled) return { success: false, error: errorMessage(new Error("integrations_not_available"), NO_ACCESS) }
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  if (!(await workspaceIntegrationsPlanEnabled(workspaceId))) return { success: false, error: errorMessage(new Error("integrations_plan_required"), NO_ACCESS) }

  const ready = await listReadyToPushDocuments(workspaceId, connectionId)
  let pushed = 0
  let failed = 0
  for (const doc of ready) {
    try {
      const result = await pushDocumentToConnection(workspaceId, doc.id, connectionId, user.id, accountOverrides?.[doc.id])
      if (result.status === "failed") failed += 1
      else pushed += 1
    } catch {
      failed += 1
    }
  }
  await recordDocumentAudit({ workspaceId, actorId: user.id, type: "integration_batch_push", detail: { connectionId, pushed, failed, totalReady: ready.length } })
  revalidatePath(`/workspaces/${workspaceId}/accounting`)
  return { success: true, data: { pushed, failed } }
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
