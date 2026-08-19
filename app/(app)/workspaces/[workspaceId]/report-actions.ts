"use server"

import { ActionState } from "@/lib/actions"
import { getCurrentUser } from "@/lib/auth"
import type { CompletenessReport } from "@/lib/report-completeness"
import { createReportDraft, getReportDraft, listDocumentReportDrafts, signReport } from "@/models/report-drafts"
import { revalidatePath } from "next/cache"
import { NO_ACCESS, paths, requireMember } from "./action-helpers"

/** Report drafting and sign-off actions.
 *
 * These live in their own file rather than in actions.ts because of the "use server" export rule:
 * everything exported from a "use server" module becomes a callable endpoint, so keeping the
 * sign-off action in a small, entirely-auditable file makes the security surface easy to read.
 * (See the memory note on "use server" modules — they can only export async functions.) */

export async function createReportDraftAction(workspaceId: string, documentId: string): Promise<ActionState<{ draftId: string; renderedText: string; completeness: CompletenessReport } | null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    const result = await createReportDraft({ workspaceId, documentId })
    if (!result) return { success: false, error: "This workspace has no report template for that specimen type." }
    revalidatePath(`${paths(workspaceId).documents}/${documentId}`)
    return { success: true, data: { draftId: result.draftId, renderedText: result.renderedText, completeness: result.completeness } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not draft the report" }
  }
}

/** THE ONLY ACTION THAT SIGNS A REPORT.
 *
 * Requires an authenticated workspace member — a link-shared editor, who has no account, cannot
 * reach it (unlike updateDocumentField, which deliberately accepts a null actor). Sign-off is
 * attributable by definition, so an unattributable signer is refused rather than recorded as null.
 *
 * The caller must pass the draft id they were shown, so signing always refers to a specific
 * rendered version rather than "whatever the latest draft happens to be now". */
export async function signReportAction(workspaceId: string, draftId: string): Promise<ActionState<{ signedAt: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    const draft = await getReportDraft(workspaceId, draftId)
    if (!draft) return { success: false, error: "Report draft not found" }
    const signed = await signReport({ workspaceId, draftId, actorId: user.id })
    revalidatePath(`${paths(workspaceId).documents}/${draft.documentId}`)
    return { success: true, data: { signedAt: (signed.signedAt ?? new Date()).toISOString() } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Could not sign the report" }
  }
}

export async function listReportDraftsAction(workspaceId: string, documentId: string): Promise<ActionState<Array<{ id: string; version: number; status: string; signedAt: string | null }>>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  const drafts = await listDocumentReportDrafts(workspaceId, documentId)
  return { success: true, data: drafts.map((draft) => ({ id: draft.id, version: draft.version, status: draft.status, signedAt: draft.signedAt?.toISOString() ?? null })) }
}
