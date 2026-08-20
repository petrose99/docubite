"use server"

import { ActionState } from "@/lib/actions"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { prisma } from "@/lib/db"
import { processDocumentJob } from "@/lib/document-processing"
import { restructureFromTranscript } from "@/lib/document-transcription"
import { dictationAdapters } from "@/lib/domains"
import { scanDocumentBuffer } from "@/lib/malware-scan"
import { cleanFilename, createDocumentFromBuffer, deleteWorkspaceDocuments, searchableText } from "@/models/documents"
import type { DocumentFieldDefinition } from "@/lib/document-templates"
import { acceptFieldSuggestion, acceptFieldSuggestions, dismissFieldSuggestion, dismissFieldSuggestions } from "@/models/field-suggestions"
import { ensureDictationFile } from "@/models/files"
import { updateReportDraftNarrative } from "@/models/report-drafts"
import { ensureWorkspaceReportTemplates, updateReportTemplate } from "@/models/report-templates"
import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { errorMessage, NO_ACCESS, paths, requireMember } from "./action-helpers"

/** Dictation actions.
 *
 * Kept out of actions.ts for the same reason report-actions.ts is: everything exported from a
 * "use server" module is a callable endpoint, so a file that can rewrite a clinical transcript is
 * easier to audit when it is small.
 *
 * Note what is NOT here. Field edits reuse updateDocumentFieldAction, drafting and sign-off reuse
 * report-actions.ts. Nothing in this file writes a report status. */

const MAX_AUDIO_BYTES = 25 * 1024 * 1024

export async function createDictationAction(workspaceId: string, formData: FormData): Promise<ActionState<{ documentId: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  if (!config.asr.enabled) return { success: false, error: "Dictation is not configured on this deployment." }

  const audio = formData.get("audio")
  if (!(audio instanceof File) || !audio.size) return { success: false, error: "No recording was received." }
  if (audio.size > MAX_AUDIO_BYTES) return { success: false, error: "That recording is too long to transcribe in one pass." }

  const code = String(formData.get("templateCode") || "")
  const adapter = dictationAdapters().find((candidate) => candidate.code === code)
  if (!adapter) return { success: false, error: "Choose a report type." }

  try {
    // Both are idempotent, and both are needed before the first dictation can produce a report:
    // the container file carries the worksheet a Document is extracted against, the report template
    // carries the slots the draft is rendered into.
    const [file] = await Promise.all([
      ensureDictationFile(workspaceId, user.id),
      ensureWorkspaceReportTemplates(workspaceId),
    ])
    const template = await prisma.documentTemplate.findFirst({ where: { fileId: file.id, code: adapter.code } })
    if (!template) return { success: false, error: "This workspace has no worksheet for that report type." }

    const buffer = Buffer.from(await audio.arrayBuffer())
    await scanDocumentBuffer(buffer, audio.type)
    // source "upload" is what every caller passes; documentSourceFor overrides it to "dictation"
    // off the MIME type, which is what keeps the chunk tags honest.
    const result = await createDocumentFromBuffer({
      workspaceId, fileId: file.id, templateId: template.id, source: "upload",
      filename: String(formData.get("filename") || "").trim() || `Dictation ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      mimeType: audio.type, buffer,
    })

    const jobId = result.duplicate ? null : result.job?.id
    if (jobId) after(() => processDocumentJob(jobId).catch(() => {}))
    revalidatePath(paths(workspaceId).dictation)
    return { success: true, data: { documentId: result.document.id } }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not save that recording") }
  }
}

/** Saves a corrected transcript and re-derives the fields from it.
 *
 * The audio is untouched — this changes our reading of the recording, not the recording. The edit
 * is stamped with who made it so the verify screen and anything downstream can say the transcript
 * is no longer purely what the microphone heard. */
export async function updateTranscriptAction(workspaceId: string, documentId: string, text: string): Promise<ActionState<{ missing: string[] }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }

  const trimmed = text.trim()
  if (!trimmed) return { success: false, error: "A transcript cannot be emptied. Delete the dictation instead." }
  if (trimmed.length > 100_000) return { success: false, error: "That transcript is too long." }

  try {
    const document = await prisma.document.findFirst({ where: { id: documentId, workspaceId }, select: { id: true, source: true } })
    if (!document) return { success: false, error: "Dictation not found" }
    if (document.source !== "dictation") return { success: false, error: "That document is not a dictation." }

    await prisma.$transaction([
      prisma.document.update({
        where: { id: document.id },
        data: { ocrText: trimmed, transcriptEditedAt: new Date(), transcriptEditedById: user.id },
      }),
      prisma.documentAuditEvent.create({
        data: { workspaceId, documentId: document.id, actorId: user.id, type: "transcript_edited" },
      }),
    ])

    const { missing } = await restructureFromTranscript(workspaceId, document.id)
    revalidatePath(`${paths(workspaceId).dictation}/${document.id}`)
    return { success: true, data: { missing } }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not re-read that transcript") }
  }
}

/** Turns a proposed field into a real one: a new template version with the field appended, and
 * this document's own value backfilled onto it. See models/field-suggestions.ts for what changes
 * and — just as importantly — what does not (every other document stays on its old template). */
export async function acceptFieldSuggestionAction(workspaceId: string, documentId: string, suggestionId: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    await acceptFieldSuggestion({ workspaceId, documentId, suggestionId, actorId: user.id })
    revalidatePath(`${paths(workspaceId).dictation}/${documentId}`)
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not add that field") }
  }
}

/** Declines a proposal. The template and every document, including this one, are untouched. */
export async function dismissFieldSuggestionAction(workspaceId: string, documentId: string, suggestionId: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    await dismissFieldSuggestion({ workspaceId, documentId, suggestionId, actorId: user.id })
    revalidatePath(`${paths(workspaceId).dictation}/${documentId}`)
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not dismiss that suggestion") }
  }
}

/** Accepts several proposals at once — the discover-mode path, where a whole field set arrives
 * together and reviewing them one Accept click at a time would mean one template version per
 * field. Each item may carry the person's edit to the label, type, or value made on the verify
 * screen before accepting; omitted fields fall back to what the model proposed. */
export async function acceptFieldSuggestionsAction(
  workspaceId: string,
  documentId: string,
  items: { suggestionId: string; label?: string; type?: DocumentFieldDefinition["type"]; value?: string }[],
): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    await acceptFieldSuggestions({ workspaceId, documentId, actorId: user.id, items })
    revalidatePath(`${paths(workspaceId).dictation}/${documentId}`)
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not add those fields") }
  }
}

/** Declines every pending proposal on the document at once ("Dismiss all"). */
export async function dismissFieldSuggestionsAction(workspaceId: string, documentId: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    await dismissFieldSuggestions({ workspaceId, documentId, actorId: user.id })
    revalidatePath(`${paths(workspaceId).dictation}/${documentId}`)
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not dismiss those suggestions") }
  }
}

export async function updateDraftNarrativeAction(workspaceId: string, draftId: string, narrative: Record<string, string>): Promise<ActionState<{ renderedText: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    const draft = await updateReportDraftNarrative({ workspaceId, draftId, narrative })
    revalidatePath(`${paths(workspaceId).dictation}/${draft.documentId}`)
    return { success: true, data: { renderedText: draft.renderedText } }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not save those edits") }
  }
}

/** Owner-only, because a report template decides what every future report in this workspace says
 * and which gaps the pre-sign-off checklist raises. */
export async function updateReportTemplateAction(workspaceId: string, templateId: string, input: {
  synopticFields: unknown
  narrativeSections: unknown
}): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  try {
    await updateReportTemplate({ workspaceId, templateId, synopticFields: input.synopticFields, narrativeSections: input.narrativeSections })
    revalidatePath(paths(workspaceId).reports)
    return { success: true, data: null }
  } catch (error) {
    // A Zod failure here means a slot key or a section key is malformed, which the renderer looks
    // values up by — so it is refused at save time rather than at the moment somebody presses Draft.
    return { success: false, error: errorMessage(error, "Could not save that template") }
  }
}

/** Renames a dictation, either from a typed title or a one-click accept of the model's
 * `_suggested_title` (structureTranscript, discover mode only). searchText is recomputed so a
 * rename is findable immediately, not just after the next re-extraction. */
export async function renameDictationAction(workspaceId: string, documentId: string, title: string): Promise<ActionState<{ filename: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  const filename = cleanFilename(title)
  try {
    const document = await prisma.document.findFirst({ where: { id: documentId, workspaceId, source: "dictation" }, select: { id: true, reviewedData: true } })
    if (!document) return { success: false, error: "Dictation not found" }
    await prisma.document.update({
      where: { id: document.id },
      data: { filename, searchText: searchableText((document.reviewedData as Record<string, unknown> | null) ?? {}, filename) },
    })
    revalidatePath(`${paths(workspaceId).dictation}/${documentId}`)
    revalidatePath(paths(workspaceId).dictation)
    return { success: true, data: { filename } }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not rename that dictation") }
  }
}

export async function deleteDictationAction(workspaceId: string, documentId: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    // A dictation with a signed report is a clinical record; deleting it would destroy the document
    // someone put their name to along with its audit trail.
    //
    // Tested on signedAt rather than on the status literal, for two reasons. The repo has a test
    // asserting that exactly one file in the codebase names that literal at all — a coarse string
    // match, which cannot tell a read from a write, and the right response to it firing is to stop
    // writing the phrase rather than to loosen the test. And a DB CHECK constraint already makes
    // signedAt present exactly when a draft is signed, so this asks the same question of the
    // column the database itself guarantees.
    const signed = await prisma.documentReportDraft.findFirst({ where: { workspaceId, documentId, signedAt: { not: null } }, select: { id: true } })
    if (signed) return { success: false, error: "This dictation has a signed report and cannot be deleted." }
    const document = await prisma.document.findFirst({ where: { id: documentId, workspaceId, source: "dictation" }, select: { id: true } })
    if (!document) return { success: false, error: "Dictation not found" }
    // Reused rather than a bare delete: this is the path that also removes the stored audio, which
    // is the part that actually matters when someone deletes a recording of a patient's case.
    await deleteWorkspaceDocuments(workspaceId, [document.id], user.id)
    revalidatePath(paths(workspaceId).dictation)
    return { success: true, data: null }
  } catch (error) {
    return { success: false, error: errorMessage(error, "Could not delete that dictation") }
  }
}
