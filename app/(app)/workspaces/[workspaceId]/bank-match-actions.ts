"use server"

import { ActionState } from "@/lib/actions"
import { getCurrentUser } from "@/lib/auth"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { decideBankMatch, regenerateBankMatchSuggestions, regenerateSupplierStatementMatches } from "@/models/bank-matches"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { errorMessage, NO_ACCESS, requireMember } from "./action-helpers"

async function requireBankMatchAccess(workspaceId: string, kind: "bank" | "supplier_statement"): Promise<{ userId: string } | null> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return null
  const capabilities = await getWorkspaceCapabilities(workspaceId)
  if (!capabilities.has(kind === "bank" ? "bank-match" : "statement-packs")) return null
  return { userId: user.id }
}

export async function decideBankMatchAction(workspaceId: string, matchId: string, status: "accepted" | "rejected"): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    const updated = await decideBankMatch({ workspaceId, matchId, status, actorId: user.id })
    revalidatePath(`/workspaces/${workspaceId}/documents/${updated.statementDocumentId}`)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not update that match") } }
}

export async function regenerateBankMatchesAction(workspaceId: string, statementDocumentId: string): Promise<ActionState<null>> {
  const access = await requireBankMatchAccess(workspaceId, "bank")
  if (!access) return { success: false, error: NO_ACCESS }
  try {
    const document = await prisma.document.findFirst({ where: { id: statementDocumentId, workspaceId }, select: { id: true } })
    if (!document) return { success: false, error: "That document no longer exists" }
    await regenerateBankMatchSuggestions(workspaceId, statementDocumentId)
    revalidatePath(`/workspaces/${workspaceId}/documents/${statementDocumentId}`)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not regenerate matches") } }
}

export async function regenerateSupplierStatementMatchesAction(workspaceId: string, statementDocumentId: string): Promise<ActionState<null>> {
  const access = await requireBankMatchAccess(workspaceId, "supplier_statement")
  if (!access) return { success: false, error: NO_ACCESS }
  try {
    const document = await prisma.document.findFirst({ where: { id: statementDocumentId, workspaceId }, select: { id: true } })
    if (!document) return { success: false, error: "That document no longer exists" }
    await regenerateSupplierStatementMatches(workspaceId, statementDocumentId)
    revalidatePath(`/workspaces/${workspaceId}/documents/${statementDocumentId}`)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not regenerate matches") } }
}
