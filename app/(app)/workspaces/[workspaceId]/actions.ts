"use server"

import type { SuggestResult } from "@/components/extract/types"
import { ActionState } from "@/lib/actions"
import { recordDocumentAudit } from "@/lib/audit"
import config from "@/lib/config"
import { processDocumentJob } from "@/lib/document-processing"
import { sampleDocumentPages, suggestFieldsFromBuffer, suggestFieldsFromContents } from "@/lib/document-suggest"
import { DocumentFieldDefinition, documentTemplateFieldsSchema, parseTemplateFields } from "@/lib/document-templates"
import { buildShapeSignature, matchShape } from "@/lib/shape-match"
import { listShapesForMatch } from "@/models/extraction-shapes"
import { createIngestionItem } from "@/lib/ingestion"
import { scanDocumentBuffer } from "@/lib/malware-scan"
import { parsePageRange } from "@/lib/page-range"
import { expandZipBuffer } from "@/lib/zip-ingestion"
import { deleteWorkspaceDocuments, getDocumentsStatus, getWorkspaceDocument, markDocumentsReviewed, requeueDocumentExtraction, updateDocumentField, updateDocumentReview, validateDocumentInput } from "@/models/documents"
import { addDomainPackToFile, canEdit, createFile, createFolder, deleteFiles, deleteFolder, duplicateFile, getFileAccess, getFileTemplates, getWorkspaceFile, listFileShares, moveToFolder, removeFileShare, renameFile, renameFolder, setLinkAccess, touchFile, upsertFileShare } from "@/models/files"
import { consumeWorkspaceQuota, setProductMode } from "@/models/workspaces"
import { parseProductMode } from "@/types/product-mode"
import { getCurrentUser, getViewerUser } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { z } from "zod"
import { errorMessage, NO_ACCESS, paths, requireMember, sheetPath } from "./action-helpers"

const templateForm = z.object({ name: z.string().trim().min(2).max(80), code: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/), fields: z.string().min(2), prompt: z.string().max(2000).optional() })

/** Every sheet mutation touches two surfaces: the sheet itself and the Files list, whose LAST
 * UPDATED column is only meaningful if the file's timestamp moves with the work. */
async function revalidateSheet(workspaceId: string, fileId: string) {
  await touchFile(fileId)
  revalidatePath(sheetPath(workspaceId, fileId))
  revalidatePath(paths(workspaceId).files)
}

export async function uploadDocumentsAction(workspaceId: string, fileId: string, formData: FormData): Promise<ActionState<{ count: number; documents: Array<{ id: string; filename: string; duplicate: boolean }> }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  if (!(await getWorkspaceFile(workspaceId, fileId))) return { success: false, error: "File not found" }
  const templates = await getFileTemplates(workspaceId, fileId)
  const template = templates.find((item) => item.id === String(formData.get("templateId"))) || templates.find((item) => item.code === "generic")
  if (!template) return { success: false, error: "Choose a document template" }
  const files = formData.getAll("files").filter((file): file is File => file instanceof File && file.size > 0)
  if (!files.length) return { success: false, error: "Choose at least one PDF or image" }
  try {
    const pageRangeRaw = String(formData.get("pageRange") || "").trim()
    parsePageRange(pageRangeRaw)
    // A grouping key shared by every file of one multi-file drag, so the batch can be reported on.
    const uploadBatchId = String(formData.get("uploadBatchId") || "").trim() || null
    // "camera" (WP13's mobile capture sheet) is the only other source this action is ever called
    // with today; anything else falls back to the ordinary "upload" it always meant.
    const source = String(formData.get("source") || "") === "camera" ? "camera" : "upload"
    let count = 0
    const documents: Array<{ id: string; filename: string; duplicate: boolean }> = []
    let rejection: string | null = null
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer())
      // createIngestionItem wraps the malware scan and createDocumentFromBuffer, and never throws
      // for a rejection — the caller decides what a rejected file means for the batch, rather than
      // one bad file in a multi-file drop aborting every other file's upload.
      const outcome = await createIngestionItem({ workspaceId, fileId, templateId: template.id, source, filename: file.name, mimeType: file.type, buffer, pageRange: pageRangeRaw || null, uploadBatchId })
      if (outcome.outcome === "rejected") { rejection = outcome.errorCode; continue }
      if (outcome.outcome === "duplicate") {
        if (outcome.item.documentId) documents.push({ id: outcome.item.documentId, filename: file.name, duplicate: true })
        continue
      }
      if (!outcome.duplicateInFile) count++
      documents.push({ id: outcome.document.id, filename: outcome.document.filename, duplicate: outcome.duplicateInFile })
      // Best-effort in-process kick so extraction runs even without the worker; the job's
      // atomic claim makes this safe when the worker is running too.
      const jobId = outcome.duplicateInFile ? null : outcome.job?.id
      if (jobId) after(() => processDocumentJob(jobId).catch(() => {}))
    }
    await revalidateSheet(workspaceId, fileId)
    if (!documents.length && rejection) return { success: false, error: errorMessage(new Error(rejection), "Upload failed") }
    return { success: true, data: { count, documents } }
  } catch (error) { return { success: false, error: errorMessage(error, "Upload failed") } }
}

/** Server-side ZIP expansion (WP9): one IngestionItem/Document per entry, each accepted or
 * skipped independently — a batch of 40 clean files must not be held hostage by one corrupt or
 * unsupported entry. Reuses the exact upload pipeline (createIngestionItem) a drag-and-drop upload
 * does, so a ZIP is not a second, differently-behaved intake path. */
export async function uploadZipAction(workspaceId: string, fileId: string, formData: FormData): Promise<ActionState<{ count: number; documents: Array<{ id: string; filename: string; duplicate: boolean }>; skipped: number; truncated: boolean }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  if (!(await getWorkspaceFile(workspaceId, fileId))) return { success: false, error: "File not found" }
  const templates = await getFileTemplates(workspaceId, fileId)
  const template = templates.find((item) => item.id === String(formData.get("templateId"))) || templates.find((item) => item.code === "generic")
  if (!template) return { success: false, error: "Choose a document template" }
  const zip = formData.get("file")
  if (!(zip instanceof File) || !zip.size) return { success: false, error: "Choose a ZIP file" }

  try {
    const zipBuffer = Buffer.from(await zip.arrayBuffer())
    const { entries, skipped, truncated } = expandZipBuffer(zipBuffer)
    if (!entries.length) return { success: false, error: "No supported documents found in that ZIP" }

    const uploadBatchId = crypto.randomUUID()
    let count = 0
    const documents: Array<{ id: string; filename: string; duplicate: boolean }> = []
    for (const entry of entries) {
      const outcome = await createIngestionItem({ workspaceId, fileId, templateId: template.id, source: "zip", filename: entry.filename, mimeType: entry.mimeType, buffer: entry.buffer, uploadBatchId })
      if (outcome.outcome === "rejected") { continue }
      if (outcome.outcome === "duplicate") {
        if (outcome.item.documentId) documents.push({ id: outcome.item.documentId, filename: entry.filename, duplicate: true })
        continue
      }
      if (!outcome.duplicateInFile) count++
      documents.push({ id: outcome.document.id, filename: outcome.document.filename, duplicate: outcome.duplicateInFile })
      const jobId = outcome.duplicateInFile ? null : outcome.job?.id
      if (jobId) after(() => processDocumentJob(jobId).catch(() => {}))
    }
    await revalidateSheet(workspaceId, fileId)
    return { success: true, data: { count, documents, skipped: skipped.length, truncated } }
  } catch (error) { return { success: false, error: errorMessage(error, "ZIP upload failed") } }
}

export async function saveDocumentReviewAction(workspaceId: string, documentId: string, formData: FormData): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  const document = await getWorkspaceDocument(workspaceId, documentId)
  if (!document) return { success: false, error: "Document not found" }
  try {
    const fields = parseTemplateFields(document.fieldSnapshot)
    const data: Record<string, unknown> = {}
    for (const field of fields) {
      if (field.type === "boolean") { data[field.key] = formData.get(field.key) === "true"; continue }
      if (field.type === "array") {
        if (field.itemFields?.length) {
          const itemKeys = new Set(field.itemFields.map((item) => item.key))
          const itemTypeByKey = new Map(field.itemFields.map((item) => [item.key, item.type]))
          const pattern = new RegExp(`^${field.key}\\[(\\d+)\\]\\[([a-z0-9_]+)\\]$`)
          const rows: Record<number, Record<string, unknown>> = {}
          for (const [name, value] of formData.entries()) {
            const match = name.match(pattern)
            if (!match || !itemKeys.has(match[2]) || typeof value !== "string" || value === "") continue
            const [, indexPart, itemKey] = match
            const itemType = itemTypeByKey.get(itemKey)
            const row = (rows[Number(indexPart)] ||= {})
            row[itemKey] = itemType === "number" ? Number(value) : itemType === "boolean" ? value === "true" : value
          }
          const orderedRows = Object.keys(rows).map(Number).sort((a, b) => a - b).map((index) => rows[index])
          if (orderedRows.length) data[field.key] = orderedRows
          continue
        }
        const raw = formData.get(field.key)
        if (typeof raw === "string" && raw) { try { data[field.key] = JSON.parse(raw) } catch { /* legacy free-form array field left invalid */ } }
        continue
      }
      const raw = formData.get(field.key)
      if (typeof raw !== "string" || raw === "") continue
      if (field.type === "number") { data[field.key] = Number(raw); continue }
      data[field.key] = raw
    }
    await updateDocumentReview({ workspaceId, documentId, reviewedData: data, actorId: user.id }); revalidatePath(`${paths(workspaceId).documents}/${documentId}`); await revalidateSheet(workspaceId, document.fileId); return { success: true, data: null }
  } catch { return { success: false, error: "Check the field values" } }
}

export async function createDocumentTemplateAction(workspaceId: string, formData: FormData): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  const parsed = templateForm.safeParse(Object.fromEntries(formData)); if (!parsed.success) return { success: false, error: "Check the template name, code, and fields" }
  // Worksheet codes are unique per file, so a template always has to be created into one.
  const fileId = String(formData.get("fileId") || "")
  if (!(await getWorkspaceFile(workspaceId, fileId))) return { success: false, error: "Choose a file to add this template to" }
  try {
    const fields = parseTemplateFields(JSON.parse(parsed.data.fields))
    await prisma.documentTemplate.create({ data: { workspaceId, fileId, name: parsed.data.name, code: parsed.data.code, documentType: "generic", versions: { create: { version: 1, fields, prompt: parsed.data.prompt?.trim() || null } } } })
    revalidatePath(paths(workspaceId).templates); return { success: true, data: null }
  } catch { return { success: false, error: "Fields must be a valid JSON array with unique field definitions" } }
}

export async function addDomainPackAction(workspaceId: string, fileId: string, domain: string): Promise<ActionState<{ added: number }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  if (!(await getWorkspaceFile(workspaceId, fileId))) return { success: false, error: "File not found" }
  try {
    const result = await addDomainPackToFile(workspaceId, fileId, domain)
    revalidatePath(paths(workspaceId).templates)
    return { success: true, data: result }
  } catch { return { success: false, error: "Could not add that domain pack" } }
}

export async function updateDocumentTemplateAction(workspaceId: string, templateId: string, formData: FormData): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  const parsed = templateForm.omit({ code: true }).safeParse(Object.fromEntries(formData)); if (!parsed.success) return { success: false, error: "Check the template fields" }
  const template = await prisma.documentTemplate.findFirst({ where: { id: templateId, workspaceId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } }); if (!template?.versions[0]) return { success: false, error: "Template not found" }
  try {
    const fields = parseTemplateFields(JSON.parse(parsed.data.fields)); const old = parseTemplateFields(template.versions[0].fields)
    if (old.some((field) => !fields.some((next) => next.key === field.key && next.type === field.type))) return { success: false, error: "Field keys and types are permanent; add a new field instead" }
    await prisma.$transaction([prisma.documentTemplate.update({ where: { id: template.id }, data: { name: parsed.data.name, currentVersion: { increment: 1 } } }), prisma.documentTemplateVersion.create({ data: { templateId: template.id, version: template.currentVersion + 1, fields, prompt: parsed.data.prompt?.trim() || null } })])
    revalidatePath(paths(workspaceId).templates); return { success: true, data: null }
  } catch { return { success: false, error: "Fields must be valid" } }
}

export async function updateDocumentFieldAction(workspaceId: string, documentId: string, fieldKey: string, value: unknown): Promise<ActionState<{ status: string; missingRequiredFields: string[] }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  if (typeof value === "string" && value.length > 100_000) return { success: false, error: "Value too large" }
  if (value !== null && typeof value === "object" && JSON.stringify(value).length > 100_000) return { success: false, error: "Value too large" }
  try {
    const result = await updateDocumentField({ workspaceId, documentId, fieldKey, value, actorId: user.id })
    await revalidateSheet(workspaceId, result.document.fileId)
    return { success: true, data: { status: result.document.status, missingRequiredFields: result.missingRequiredFields } }
  } catch (error) { return { success: false, error: errorMessage(error, "Update failed") } }
}

export async function markDocumentsReviewedAction(workspaceId: string, fileId: string, documentIds: string[]): Promise<ActionState<{ reviewed: number; needsReview: number }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  if (!documentIds.length) return { success: false, error: "Select at least one document" }
  try {
    const result = await markDocumentsReviewed(workspaceId, documentIds, user.id)
    await revalidateSheet(workspaceId, fileId)
    return { success: true, data: result }
  } catch (error) { return { success: false, error: errorMessage(error, "Review failed") } }
}

/** Samples the first staged file and either recognises it as a previously-seen shape — offering
 * that setup back with no LLM call and no credit spent — or proposes fresh columns (or one column
 * when the user described it in plain English), which costs one AI extraction credit.
 *
 * The quota is charged only on the paths that actually call the LLM: matching a saved shape is
 * free, which is what lets a workspace re-run the same kind of document all month without burning
 * a suggestion credit each time. Single-column requests never match and always suggest. */
export async function suggestTemplateFieldsAction(workspaceId: string, formData: FormData): Promise<ActionState<SuggestResult>> {
  const user = await getCurrentUser()
  const membership = await requireMember(workspaceId, user.id)
  if (!membership) return { success: false, error: NO_ACCESS }
  if (!membership.workspace.aiEnabled) return { success: false, error: "AI extraction is disabled for this workspace" }
  const file = formData.get("file")
  if (!(file instanceof File) || !file.size) return { success: false, error: "Add a document first" }
  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    validateDocumentInput(buffer, file.type)
    await scanDocumentBuffer(buffer, file.type)
    const singleColumn = String(formData.get("singleColumn") || "").trim() || undefined
    // "Start fresh" on the same-shape card sets this to force an LLM suggestion past any match.
    const skipShapeMatch = formData.get("skipShapeMatch") === "1"

    if (!singleColumn) {
      const contents = await sampleDocumentPages({ buffer, mimeType: file.type, filename: file.name })
      const firstPageText = contents.find((content) => content.page === 1)?.text ?? contents[0]?.text ?? ""
      const matched = skipShapeMatch ? null : matchShape(await listShapesForMatch(workspaceId), buildShapeSignature({ firstPageText }))
      if (matched) {
        const parsed = documentTemplateFieldsSchema.safeParse(matched.fields)
        if (parsed.success) {
          const lastFilename = matched.lastDocumentId
            ? (await prisma.document.findFirst({ where: { id: matched.lastDocumentId, workspaceId }, select: { filename: true } }))?.filename ?? null
            : null
          return { success: true, data: { suggestion: null, matchedShape: { id: matched.id, name: matched.name, docType: matched.docType ?? "", entity: matched.entity ?? "", fields: parsed.data, prompt: matched.prompt ?? "", multiRow: matched.multiRow, lastRunAt: matched.updatedAt.toISOString(), lastFilename } } }
        }
      }
      await consumeWorkspaceQuota(workspaceId, "ai")
      return { success: true, data: { suggestion: await suggestFieldsFromContents(contents), matchedShape: null } }
    }

    await consumeWorkspaceQuota(workspaceId, "ai")
    return { success: true, data: { suggestion: await suggestFieldsFromBuffer({ buffer, mimeType: file.type, filename: file.name, singleColumn }), matchedShape: null } }
  } catch (error) { return { success: false, error: errorMessage(error, "Suggestion failed") } }
}

const extractionSheetPayload = z.object({ name: z.string().trim().min(2).max(80), fields: z.unknown(), prompt: z.string().max(2000), multiRow: z.boolean() })

/** Creates or updates the extraction sheet the panel is editing. Sheets may be reshaped
 * freely: already-extracted documents keep their own field snapshots, so removing or
 * retyping a column only affects how existing values are displayed, never the stored data. */
export async function saveExtractionSheetAction(workspaceId: string, fileId: string, templateId: string | null, payload: { name: string; fields: DocumentFieldDefinition[]; prompt: string; multiRow: boolean }): Promise<ActionState<{ templateId: string; code: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  if (!(await getWorkspaceFile(workspaceId, fileId))) return { success: false, error: "File not found" }
  const parsed = extractionSheetPayload.safeParse(payload)
  if (!parsed.success) return { success: false, error: "Check the sheet name and settings" }
  const fieldsParsed = documentTemplateFieldsSchema.safeParse(parsed.data.fields)
  if (!fieldsParsed.success) return { success: false, error: "Add at least one valid column" }
  const fields = fieldsParsed.data
  const prompt = parsed.data.prompt.trim() || null
  try {
    if (!templateId) {
      const slug = parsed.data.name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^[^a-z]+/, "").replace(/_+$/, "").slice(0, 40) || "sheet"
      const code = `${slug}_${crypto.randomUUID().slice(0, 8)}`
      const template = await prisma.documentTemplate.create({ data: { workspaceId, fileId, name: parsed.data.name, code, documentType: "generic", multiRow: parsed.data.multiRow, versions: { create: { version: 1, fields, prompt } } } })
      await revalidateSheet(workspaceId, fileId)
      return { success: true, data: { templateId: template.id, code: template.code } }
    }
    const template = await prisma.documentTemplate.findFirst({ where: { id: templateId, workspaceId, fileId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } })
    if (!template?.versions[0]) return { success: false, error: "Sheet not found" }
    await prisma.$transaction([
      prisma.documentTemplate.update({ where: { id: template.id }, data: { name: parsed.data.name, multiRow: parsed.data.multiRow, currentVersion: { increment: 1 } } }),
      prisma.documentTemplateVersion.create({ data: { templateId: template.id, version: template.currentVersion + 1, fields, prompt } }),
    ])
    await revalidateSheet(workspaceId, fileId)
    return { success: true, data: { templateId: template.id, code: template.code } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not save the sheet") } }
}

/** Interval-polled by the extraction progress hook; deliberately no revalidatePath. */
export async function getDocumentProcessingStatusAction(workspaceId: string, documentIds: string[]): Promise<ActionState<Array<{ id: string; status: string; errorCode: string | null; filename: string; searchable: boolean; indexing: boolean; flaggedFields: string[] }>>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    return { success: true, data: await getDocumentsStatus(workspaceId, documentIds) }
  } catch (error) { return { success: false, error: error instanceof Error ? error.message.replaceAll("_", " ") : "Status check failed" } }
}

export async function deleteDocumentsAction(workspaceId: string, fileId: string, documentIds: string[]): Promise<ActionState<{ deleted: number }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  if (!documentIds.length) return { success: false, error: "Select at least one document" }
  try {
    const result = await deleteWorkspaceDocuments(workspaceId, documentIds, user.id)
    await revalidateSheet(workspaceId, fileId)
    return { success: true, data: result }
  } catch (error) { return { success: false, error: errorMessage(error, "Delete failed") } }
}

export async function reprocessDocumentAction(workspaceId: string, fileId: string, documentId: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    const job = await requeueDocumentExtraction(workspaceId, documentId)
    after(() => processDocumentJob(job.id).catch(() => {}))
    await revalidateSheet(workspaceId, fileId)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Re-process failed") } }
}

export async function setWorkspaceAiAction(workspaceId: string, enabled: boolean): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  try {
    await prisma.workspace.update({ where: { id: workspaceId }, data: { aiEnabled: enabled } })
    revalidatePath(paths(workspaceId).workspace)
    return { success: true, data: null }
  } catch { return { success: false, error: "Could not change the AI setting" } }
}

/** F15: turning hipaaMode on immediately forces every file's linkAccess back to "none" — the
 * whole point is that no file in a hipaaMode workspace should be openable by a bare URL, and
 * leaving already-shared links live until someone happens to touch them would defeat that. This
 * is itself a security-relevant setting change, so it gets its own audit event rather than
 * inheriting the generic Workspace-edit path the admin console uses. */
export async function setWorkspaceHipaaModeAction(workspaceId: string, enabled: boolean): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  const membership = await requireMember(workspaceId, user.id, ["owner"])
  if (!membership) return { success: false, error: NO_ACCESS }
  // hipaaMode presumes ePHI, which is clinical-mode territory — see setProductMode. An empty
  // workspace turning it on for the first time is auto-switched into clinical mode rather than
  // refused; one that already has accounting-mode content is refused rather than silently
  // reclassifying it.
  if (enabled && membership.workspace.productMode !== "clinical") {
    try {
      await setProductMode({ workspaceId, actorId: user.id, mode: "clinical" })
    } catch (error) {
      if (error instanceof Error && error.message === "product_mode_locked") {
        return { success: false, error: "Switch this workspace to clinical mode in Workspace settings before enabling HIPAA mode — it already has files in accounting mode." }
      }
      return { success: false, error: "Could not change the HIPAA mode setting" }
    }
  }
  try {
    await prisma.$transaction([
      prisma.workspace.update({ where: { id: workspaceId }, data: { hipaaMode: enabled } }),
      ...(enabled ? [prisma.documentFile.updateMany({ where: { workspaceId, linkAccess: { not: "none" } }, data: { linkAccess: "none" } })] : []),
    ])
    await recordDocumentAudit({ workspaceId, actorId: user.id, type: enabled ? "hipaa_mode_enabled" : "hipaa_mode_disabled" })
    revalidatePath(paths(workspaceId).workspace)
    revalidatePath(paths(workspaceId).files)
    return { success: true, data: null }
  } catch { return { success: false, error: "Could not change the HIPAA mode setting" } }
}

/** The counterpart picker in Workspace settings: manual switches only, since hipaaMode's own
 * toggle already drives the auto-switch into clinical above. Locked once the workspace has any
 * content — see setProductMode. */
export async function setWorkspaceProductModeAction(workspaceId: string, mode: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  const parsed = parseProductMode(mode)
  if (!parsed) return { success: false, error: "Invalid product mode" }
  try {
    await setProductMode({ workspaceId, actorId: user.id, mode: parsed })
    revalidatePath(paths(workspaceId).workspace)
    return { success: true, data: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error"
    if (message === "product_mode_locked") return { success: false, error: "This workspace already has files — product mode can no longer be changed." }
    if (message === "hipaa_mode_requires_clinical") return { success: false, error: "Turn off HIPAA mode in this settings page before switching to accounting mode." }
    return { success: false, error: "Could not change the product mode" }
  }
}

/* ------------------------------------------------------------------ files and folders --- */

/** Matches Lido's asymmetry: `New file` creates and navigates with no dialog, so this returns
 * the id the client pushes to; `New folder` opens a name modal first. */
export async function createFileAction(workspaceId: string, folderId: string | null): Promise<ActionState<{ fileId: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    const file = await createFile({ workspaceId, userId: user.id, folderId })
    revalidatePath(paths(workspaceId).files)
    return { success: true, data: { fileId: file.id } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not create the file") } }
}

export async function renameFileAction(workspaceId: string, fileId: string, name: string): Promise<ActionState<{ name: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    const file = await renameFile(workspaceId, fileId, name)
    revalidatePath(paths(workspaceId).files)
    revalidatePath(sheetPath(workspaceId, fileId))
    return { success: true, data: { name: file.name } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not rename the file") } }
}

export async function duplicateFileAction(workspaceId: string, fileId: string): Promise<ActionState<{ fileId: string; documentsCopied: number; truncated: boolean }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    const result = await duplicateFile({ workspaceId, userId: user.id, fileId })
    revalidatePath(paths(workspaceId).files)
    return { success: true, data: { fileId: result.file.id, documentsCopied: result.documentsCopied, truncated: result.truncated } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not copy the file") } }
}

export async function deleteFilesAction(workspaceId: string, fileIds: string[]): Promise<ActionState<{ deleted: number }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  if (!fileIds.length) return { success: false, error: "Select at least one file" }
  try {
    const result = await deleteFiles(workspaceId, fileIds, user.id)
    revalidatePath(paths(workspaceId).files)
    return { success: true, data: result }
  } catch (error) { return { success: false, error: errorMessage(error, "Delete failed") } }
}

export async function moveFilesAction(workspaceId: string, fileIds: string[], folderId: string | null): Promise<ActionState<{ moved: number }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    const result = await moveToFolder(workspaceId, fileIds, folderId)
    revalidatePath(paths(workspaceId).files)
    return { success: true, data: result }
  } catch (error) { return { success: false, error: errorMessage(error, "Move failed") } }
}

export async function createFolderAction(workspaceId: string, parentId: string | null, name: string): Promise<ActionState<{ folderId: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  if (!name.trim()) return { success: false, error: "Enter a folder name" }
  try {
    const folder = await createFolder({ workspaceId, parentId, name })
    revalidatePath(paths(workspaceId).files)
    return { success: true, data: { folderId: folder.id } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not create the folder") } }
}

export async function renameFolderAction(workspaceId: string, folderId: string, name: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    await renameFolder(workspaceId, folderId, name)
    revalidatePath(paths(workspaceId).files)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not rename the folder") } }
}

export async function deleteFolderAction(workspaceId: string, folderId: string): Promise<ActionState<{ deletedFiles: number }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    const result = await deleteFolder(workspaceId, folderId, user.id)
    revalidatePath(paths(workspaceId).files)
    return { success: true, data: result }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not delete the folder") } }
}

/* --------------------------------------------------------------------------- sharing --- */

/** Loaded when the Share dialog opens rather than shipped with every row of the Files list,
 * which would mean one extra query per file for a panel most rows never show. */
export async function getFileSharingAction(workspaceId: string, fileId: string): Promise<ActionState<{ linkAccess: string; shareUrl: string; people: Array<{ email: string; access: string }>; hipaaMode: boolean }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  const file = await getWorkspaceFile(workspaceId, fileId)
  if (!file) return { success: false, error: "File not found" }
  const [people, workspace] = await Promise.all([
    listFileShares(file.id),
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { hipaaMode: true } }),
  ])
  return { success: true, data: { linkAccess: file.linkAccess, shareUrl: `${config.app.baseURL}/shared/${file.id}`, people: people.map((share) => ({ email: share.email, access: share.access })), hipaaMode: workspace?.hipaaMode ?? false } }
}

export async function setFileLinkAccessAction(workspaceId: string, fileId: string, access: string): Promise<ActionState<{ linkAccess: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    const file = await setLinkAccess(workspaceId, fileId, access)
    revalidatePath(paths(workspaceId).files)
    revalidatePath(`/shared/${fileId}`)
    return { success: true, data: { linkAccess: file.linkAccess } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not change link access") } }
}

export async function shareFileAction(workspaceId: string, fileId: string, email: string, access: string): Promise<ActionState<{ email: string; access: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  if (!z.string().email().safeParse(email.trim()).success) return { success: false, error: "Enter a valid email" }
  try {
    const share = await upsertFileShare(workspaceId, fileId, email, access)
    revalidatePath(paths(workspaceId).files)
    return { success: true, data: { email: share.email, access: share.access } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not share the file") } }
}

export async function unshareFileAction(workspaceId: string, fileId: string, email: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  try {
    await removeFileShare(workspaceId, fileId, email)
    revalidatePath(paths(workspaceId).files)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not remove access") } }
}

/* ------------------------------------------------------------------------ worksheets --- */

export async function renameWorksheetAction(workspaceId: string, fileId: string, templateId: string, name: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  const trimmed = name.trim().slice(0, 80)
  if (trimmed.length < 2) return { success: false, error: "Worksheet names need at least two characters" }
  try {
    const updated = await prisma.documentTemplate.updateMany({ where: { id: templateId, workspaceId, fileId }, data: { name: trimmed } })
    if (!updated.count) return { success: false, error: "Worksheet not found" }
    await revalidateSheet(workspaceId, fileId)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not rename the worksheet") } }
}

/** Copies the worksheet's columns, prompt, and settings under a fresh code. Extracted rows are
 * not copied: they belong to the documents that produced them, and duplicating a tab is a
 * request for the same *shape*, not a second billed copy of the same sources. */
export async function duplicateWorksheetAction(workspaceId: string, fileId: string, templateId: string): Promise<ActionState<{ code: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  try {
    const template = await prisma.documentTemplate.findFirst({ where: { id: templateId, workspaceId, fileId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } })
    const version = template?.versions[0]
    if (!template || !version) return { success: false, error: "Worksheet not found" }
    const slug = template.code.replace(/_[0-9a-f]{8}$/, "").slice(0, 40) || "sheet"
    const copy = await prisma.documentTemplate.create({ data: {
      workspaceId, fileId, name: `${template.name} copy`.slice(0, 80), code: `${slug}_${crypto.randomUUID().slice(0, 8)}`,
      documentType: template.documentType, multiRow: template.multiRow,
      versions: { create: { version: 1, fields: parseTemplateFields(version.fields), prompt: version.prompt } },
    } })
    await revalidateSheet(workspaceId, fileId)
    return { success: true, data: { code: copy.code } }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not duplicate the worksheet") } }
}

export async function deleteWorksheetAction(workspaceId: string, fileId: string, templateId: string): Promise<ActionState<null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id, ["owner"]))) return { success: false, error: NO_ACCESS }
  try {
    const remaining = await prisma.documentTemplate.count({ where: { fileId } })
    if (remaining <= 1) return { success: false, error: "A file needs at least one worksheet" }
    // Documents cascade with the worksheet, so their stored sources have to go first or they
    // are orphaned in the blob store.
    const documents = await prisma.document.findMany({ where: { fileId, templateId }, select: { id: true } })
    if (documents.length) await deleteWorkspaceDocuments(workspaceId, documents.map((document) => document.id), user.id)
    const deleted = await prisma.documentTemplate.deleteMany({ where: { id: templateId, workspaceId, fileId } })
    if (!deleted.count) return { success: false, error: "Worksheet not found" }
    await revalidateSheet(workspaceId, fileId)
    return { success: true, data: null }
  } catch (error) { return { success: false, error: errorMessage(error, "Could not delete the worksheet") } }
}

/* --------------------------------------------------------------------- shared files --- */

/** The write path for /shared/[fileId] at "Can edit".
 *
 * Every other mutation in this file authorises through workspace membership, which a link
 * viewer does not have — so these resolve the file's own access instead. They are deliberately
 * narrow: one field of one document, and the document must belong to the file whose id the
 * caller proved access to, so a share can never be used as a lever on the rest of the
 * workspace. "Can interact" never reaches here at all; that sandbox is client-side only. */
async function requireFileEditor(fileId: string) {
  const viewer = await getViewerUser()
  const resolved = await getFileAccess(fileId, viewer ? { id: viewer.id, email: viewer.email } : null)
  return resolved && canEdit(resolved.access) ? { ...resolved, viewerId: viewer?.id ?? null } : null
}

export async function updateSharedDocumentFieldAction(fileId: string, documentId: string, fieldKey: string, value: unknown): Promise<ActionState<{ status: string; missingRequiredFields: string[] }>> {
  const resolved = await requireFileEditor(fileId)
  if (!resolved) return { success: false, error: "You do not have edit access to this file" }
  if (typeof value === "string" && value.length > 100_000) return { success: false, error: "Value too large" }
  if (value !== null && typeof value === "object" && JSON.stringify(value).length > 100_000) return { success: false, error: "Value too large" }
  const document = await prisma.document.findFirst({ where: { id: documentId, fileId }, select: { id: true } })
  if (!document) return { success: false, error: "Document not found" }
  try {
    const result = await updateDocumentField({ workspaceId: resolved.file.workspaceId, documentId, fieldKey, value, actorId: resolved.viewerId })
    await revalidateSheet(resolved.file.workspaceId, fileId)
    revalidatePath(`/shared/${fileId}`)
    return { success: true, data: { status: result.document.status, missingRequiredFields: result.missingRequiredFields } }
  } catch (error) { return { success: false, error: errorMessage(error, "Update failed") } }
}

/* Workspace lifecycle actions (create, rename, delete, members, invitations) live in the
 * sibling workspace-actions.ts — every "use server" export is a public RPC endpoint, and the
 * destructive workspace surface is worth keeping in one small reviewable file. */
