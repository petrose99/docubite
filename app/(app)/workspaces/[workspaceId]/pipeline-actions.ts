"use server"

import { ActionState } from "@/lib/actions"
import type { PipelineStage } from "@/lib/documents/stages"
import { sheetToCsv } from "@/lib/sheet-export"
import { getCurrentUser } from "@/lib/auth"
import {
  countDocumentsByStage, deleteWorkspaceDocuments, documentDataForExport, getWorkspaceDocument,
  listWorkspaceDocuments, markDocumentsReviewed, mergeDocuments, setDocumentsArchived, setDocumentsFlagged,
  updateDocumentNote,
} from "@/models/documents"
import { getListPreference, saveListPreference, type ListPreference } from "@/models/list-preferences"
import { revalidatePath } from "next/cache"
import { errorMessage, NO_ACCESS, paths, requireMember } from "./action-helpers"

async function revalidatePipeline(workspaceId: string) {
  revalidatePath(paths(workspaceId).pipeline)
}

/** Moves a batch of documents onto a pipeline tab. "ready" and "archive" are the only stages a
 * bulk action can *move a document onto* directly — "inbox"/"to_review" are states extraction
 * itself produces, and "approvals" is entered by sending a document for review (a different,
 * more specific action), not a generic move. Moving onto "ready" marks the batch reviewed
 * (models/documents.markDocumentsReviewed, the same write the single-document review form makes);
 * moving onto "archive" only sets archivedAt, leaving `status` untouched, per the archive/status
 * split in lib/documents/stages.ts. */
export async function moveDocumentsToStageAction(workspaceId: string, documentIds: string[], stage: Extract<PipelineStage, "ready" | "archive">): Promise<ActionState<{ moved: number }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    if (stage === "archive") {
      const { updated } = await setDocumentsArchived(workspaceId, documentIds, true)
      revalidatePipeline(workspaceId)
      return { success: true, data: { moved: updated } }
    }
    const { reviewed, needsReview } = await markDocumentsReviewed(workspaceId, documentIds, user.id)
    revalidatePipeline(workspaceId)
    return { success: true, data: { moved: reviewed + needsReview } }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not move the selected documents") }
  }
}

export async function archiveDocumentsAction(workspaceId: string, documentIds: string[], archived: boolean): Promise<ActionState<{ updated: number }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    const result = await setDocumentsArchived(workspaceId, documentIds, archived)
    revalidatePipeline(workspaceId)
    return { success: true, data: result }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not update the selected documents") }
  }
}

export async function flagDocumentsAction(workspaceId: string, documentIds: string[], flagged: boolean): Promise<ActionState<{ updated: number }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    const result = await setDocumentsFlagged(workspaceId, documentIds, flagged, user.id)
    revalidatePipeline(workspaceId)
    return { success: true, data: result }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not flag the selected documents") }
  }
}

export async function deletePipelineDocumentsAction(workspaceId: string, documentIds: string[]): Promise<ActionState<{ deleted: number }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    const result = await deleteWorkspaceDocuments(workspaceId, documentIds, user.id)
    revalidatePipeline(workspaceId)
    return { success: true, data: result }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not delete the selected documents") }
  }
}

/** Merges exactly two selected documents — offered on the bulk bar only when the selection count
 * is 2. See models/documents.mergeDocuments for what "merge" means here. */
export async function mergeDocumentsAction(workspaceId: string, documentIds: string[]): Promise<ActionState<{ survivorId: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  if (documentIds.length !== 2) return { success: false, error: "Select exactly two documents to merge" }
  try {
    const result = await mergeDocuments(workspaceId, [documentIds[0], documentIds[1]], user.id)
    revalidatePipeline(workspaceId)
    return { success: true, data: result }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not merge the selected documents") }
  }
}

/** CSV of the selected documents, one column per key any of them has (status/received_at/every
 * reviewed field, unioned across templates) — a document-level export, deliberately not routed
 * through the sheet's own /export route (lib/sheet-export's snapshot reader), since the pipeline
 * spans documents that may never have touched a spreadsheet at all. */
export async function bulkExportDocumentsAction(workspaceId: string, documentIds: string[]): Promise<ActionState<{ csv: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  const documents = await Promise.all(documentIds.slice(0, 500).map((id) => getWorkspaceDocument(workspaceId, id)))
  const rows = documents.filter((doc): doc is NonNullable<typeof doc> => doc !== null).map((doc) => documentDataForExport(doc) as Record<string, string | number | boolean | null>)
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const csv = sheetToCsv({ name: "documents", rows: [columns, ...rows.map((row) => columns.map((column) => row[column] ?? null))] })
  return { success: true, data: { csv } }
}

export async function updateDocumentNoteAction(workspaceId: string, documentId: string, note: string): Promise<ActionState<{ note: string | null }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  if (note.length > 20_000) return { success: false, error: "Note is too long" }
  try {
    return { success: true, data: await updateDocumentNote(workspaceId, documentId, note) }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not save the note") }
  }
}

export async function countDocumentsByStageAction(workspaceId: string): Promise<ActionState<Record<PipelineStage, number>>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  return { success: true, data: await countDocumentsByStage(workspaceId) }
}

export async function getPipelineListPreferenceAction(workspaceId: string, viewKey: string): Promise<ActionState<ListPreference | null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  return { success: true, data: await getListPreference(user.id, workspaceId, viewKey) }
}

export async function savePipelineListPreferenceAction(workspaceId: string, viewKey: string, preference: ListPreference): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  await saveListPreference(user.id, workspaceId, viewKey, preference)
  return { success: true }
}

/** The pipeline list itself, scoped to one stage, workspace-wide (folder is not a filter here —
 * see the Phase 2 plan's "flatten folders" decision). */
export async function listPipelineDocumentsAction(workspaceId: string, stage: PipelineStage, query?: string) {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false as const, error: NO_ACCESS }
  const documents = await listWorkspaceDocuments(workspaceId, { stage, query })
  return { success: true as const, data: documents }
}
