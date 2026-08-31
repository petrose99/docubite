import { SUPPORTED_AUDIO_TYPES, isSupportedAudioBuffer } from "@/lib/asr/types"
import { track } from "@/lib/analytics"
import { auditEventData, getRequestAuditContext, recordDocumentAudit } from "@/lib/audit"
import { SUPPLIER_FIELD_BY_TEMPLATE } from "@/lib/automation/rules"
import config from "@/lib/config"
import { findMissingRequiredFields, parseTemplateFields, validateDocumentValues } from "@/lib/document-templates"
import { deleteDocumentSource, documentBlocksKey, documentStorageKey, putDocumentSource } from "@/lib/document-storage"
import { projectDocumentFields } from "@/lib/field-projection"
import { LOW_CONFIDENCE, PIPELINE_STAGES, stageToStatusFilter, type PipelineStage } from "@/lib/documents/stages"
import type { DocumentProvenance } from "@/lib/provenance"
import { replaceDocumentFieldValues } from "@/models/document-field-values"
import { recordFieldCorrection } from "@/models/field-corrections"
import { emitWorkspaceEvent } from "@/lib/webhooks"
import { kickWebhookDrain } from "@/lib/webhook-delivery"
import { prisma } from "@/lib/db"
import { Document, Prisma } from "@/prisma/client"
import crypto from "crypto"
import path from "path"
import { randomUUID } from "crypto"

const SUPPORTED_DOCUMENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"])
/** "dictation" is an audio recording rather than a scan; it takes the transcribe path instead of
 * MinerU, and is otherwise an ordinary Document (see lib/document-transcription). */
export type DocumentSource = "upload" | "dictation"

export const documentHash = (buffer: Buffer) => crypto.createHash("sha256").update(buffer).digest("hex")

export function cleanFilename(filename: string) {
  const sanitized = path.basename(filename).replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim()
  return (sanitized || "document").slice(0, 255)
}

export function isSupportedDocumentBuffer(buffer: Buffer, mimeType: string) {
  // Audio is validated by its own container magic bytes, and only when dictation is configured —
  // with ASR off an audio upload is refused as an unsupported type rather than accepted and queued
  // for a job that can never run.
  if (SUPPORTED_AUDIO_TYPES.has(mimeType)) return config.asr.enabled && isSupportedAudioBuffer(buffer, mimeType)
  if (!SUPPORTED_DOCUMENT_TYPES.has(mimeType)) return false
  if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-"
  if (mimeType === "image/jpeg") return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mimeType === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP"
  return buffer.subarray(4, 8).toString("ascii") === "ftyp"
}

/** Audio is always recorded as source "dictation", whatever the caller passed.
 *
 * A dictation is uploaded through the ordinary upload path — it IS an ordinary upload — so every
 * caller passes "upload". But Document.source is what later decides whether a chunk is tagged `asr`
 * or `vlm_ocr`, and trusting the caller meant every dictated snippet was cited as though it had
 * been read off a printed page. Derived here, next to the job-type choice, so the two cannot
 * disagree about what kind of document this is. */
export function documentSourceFor(mimeType: string, fallback: DocumentSource): DocumentSource {
  return SUPPORTED_AUDIO_TYPES.has(mimeType) ? "dictation" : fallback
}

export function validateDocumentInput(buffer: Buffer, mimeType: string) {
  if (!buffer.length || buffer.length > config.documents.maxFileSizeBytes) throw new Error("invalid_document_size")
  if (!isSupportedDocumentBuffer(buffer, mimeType)) throw new Error("unsupported_document_type")
}

export function searchableText(data: Record<string, unknown>, filename: string) {
  const flatten = (value: unknown): string[] => {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [String(value)]
    if (Array.isArray(value)) return value.flatMap(flatten)
    if (value && typeof value === "object") return Object.values(value).flatMap(flatten)
    return []
  }
  return [filename, ...flatten(data)].join(" ").slice(0, 20_000)
}

export async function createDocumentFromBuffer(input: {
  workspaceId: string; fileId: string; templateId: string; source: DocumentSource; filename: string; mimeType: string; buffer: Buffer; receivedAt?: Date; pageRange?: string | null; uploadBatchId?: string | null
}) {
  validateDocumentInput(input.buffer, input.mimeType)
  // Scoped by fileId as well as workspaceId: worksheet codes are only unique within a file, so
  // a template from a *different* file must never satisfy this lookup.
  const template = await prisma.documentTemplate.findFirst({
    where: { id: input.templateId, workspaceId: input.workspaceId, fileId: input.fileId },
    include: { versions: { where: { version: { not: undefined } }, orderBy: { version: "desc" }, take: 1 } },
  })
  const version = template?.versions[0]
  if (!template || !version) throw new Error("document_template_not_found")
  const sha256 = documentHash(input.buffer)
  // Dedup is per file, not per workspace: the same PDF may legitimately be extracted into two
  // different files with two different column sets.
  const existing = await prisma.document.findUnique({ where: { fileId_sha256: { fileId: input.fileId, sha256 } } })
  if (existing) {
    const job = await prisma.documentProcessingJob.findFirst({ where: { documentId: existing.id, status: "queued" }, orderBy: { createdAt: "desc" } })
    return { document: existing, job, duplicate: true }
  }

  const id = randomUUID()
  const storageKey = documentStorageKey(input.workspaceId, id)
  const receivedAt = input.receivedAt || new Date()
  await putDocumentSource(storageKey, input.buffer, input.mimeType)
  try {
    let webhookQueued = false
    const result = await prisma.$transaction(async (tx) => {
      const document = await tx.document.create({ data: {
        id, workspaceId: input.workspaceId, fileId: input.fileId, templateId: template.id, templateVersionId: version.id,
        source: documentSourceFor(input.mimeType, input.source),
        status: "queued", filename: cleanFilename(input.filename), mimeType: input.mimeType, sizeBytes: input.buffer.length,
        sha256, storageKey, receivedAt, pageRange: input.pageRange?.trim() || null, uploadBatchId: input.uploadBatchId || null,
        fieldSnapshot: version.fields as Prisma.InputJsonValue, searchText: cleanFilename(input.filename),
      } })
      // Audio goes to the transcribe handler, everything else to MinerU extraction. This is the
      // only place the two ingestion paths diverge — from the job onwards they are the same code.
      const job = await tx.documentProcessingJob.create({ data: { workspaceId: input.workspaceId, documentId: document.id, type: SUPPORTED_AUDIO_TYPES.has(input.mimeType) ? "transcribe" : "extract" } })
      await recordDocumentAudit({ workspaceId: input.workspaceId, documentId: document.id, type: "document_received" }, tx)
      const emitted = await emitWorkspaceEvent(tx, {
        workspaceId: input.workspaceId, type: "document.received", createdAt: new Date(),
        document: { id: document.id, filename: document.filename, status: document.status, receivedAt: document.receivedAt, reviewedData: document.reviewedData, templateCode: template.code, confidence: document.confidence },
      })
      webhookQueued = emitted.queued > 0
      return { document, job, duplicate: false }
    })
    if (webhookQueued) await kickWebhookDrain()
    return result
  } catch (error) {
    await deleteDocumentSource(storageKey)
    throw error
  }
}

/** The full where-fragment for one pipeline stage: stageToStatusFilter plus the two axes it can't
 * express alone — archive (a boolean-ish timestamp, not a status) and the ready/approvals split
 * (which depends on ReviewTask existence). Shared by every query that needs "is this document on
 * stage X", so the list, its counts, and a content-search filter can never disagree. */
function stageWhereClause(stage: PipelineStage): Prisma.DocumentWhereInput {
  return {
    ...stageToStatusFilter(stage),
    ...(stage !== "archive" ? { archivedAt: null } : {}),
    ...(stage === "approvals" ? { reviewTasks: { some: { status: { in: ["open", "in_review"] } } } } : {}),
    ...(stage === "ready" ? { reviewTasks: { none: { status: { in: ["open", "in_review"] } } } } : {}),
  }
}

/** `stage`, when given, narrows to a pipeline tab (lib/documents/stages.ts) instead of a raw
 * status. It composes with (does not replace) `status`, though callers normally pass one or the
 * other. Archive is its own axis: every stage except "archive" implicitly excludes an archived
 * document, so a document doesn't linger on "Ready" after being archived from it. */
export async function listWorkspaceDocuments(workspaceId: string, filters: { status?: string; query?: string; templateId?: string; fileId?: string; stage?: PipelineStage } = {}) {
  const where: Prisma.DocumentWhereInput = {
    workspaceId,
    ...(filters.fileId ? { fileId: filters.fileId } : {}),
    ...(filters.status && filters.status !== "all" ? { status: filters.status } : {}),
    ...(filters.stage ? stageWhereClause(filters.stage) : {}),
    ...(filters.query?.trim() ? { OR: [{ searchText: { contains: filters.query.trim(), mode: "insensitive" as const } }, { ocrText: { contains: filters.query.trim(), mode: "insensitive" as const } }] } : {}),
    ...(filters.templateId ? { templateId: filters.templateId } : {}),
  }
  return prisma.document.findMany({ where, include: { template: true, templateVersion: true }, orderBy: { receivedAt: "desc" }, take: 100 })
}

/** Per-stage counts for the pipeline tabs, sharing stageWhereClause with listWorkspaceDocuments so
 * a tab's badge count can never disagree with what clicking it shows. One query per stage (five
 * total) rather than a single groupBy: the ready/approvals split depends on ReviewTask existence,
 * which groupBy can't express in one pass over `status` alone. */
export async function countDocumentsByStage(workspaceId: string): Promise<Record<PipelineStage, number>> {
  const counts = await Promise.all(PIPELINE_STAGES.map((stage) => prisma.document.count({ where: { workspaceId, ...stageWhereClause(stage) } })))
  return Object.fromEntries(PIPELINE_STAGES.map((stage, index) => [stage, counts[index]])) as Record<PipelineStage, number>
}

/** Of the given document ids, which currently belong to `stage` — used to narrow the workspace-
 * wide content-search hits (lib/retrieval.ts::searchDocumentsByContent spans every document) down
 * to the tab actually being viewed, the same way the ordinary filename/OCR-text match already is. */
export async function documentIdsInStage(workspaceId: string, documentIds: string[], stage: PipelineStage): Promise<Set<string>> {
  if (!documentIds.length) return new Set()
  const rows = await prisma.document.findMany({ where: { workspaceId, id: { in: documentIds }, ...stageWhereClause(stage) }, select: { id: true } })
  return new Set(rows.map((row) => row.id))
}

export const getWorkspaceDocument = (workspaceId: string, documentId: string) => prisma.document.findFirst({ where: { id: documentId, workspaceId }, include: { template: true, templateVersion: true } })

/** Which of the given documents currently have a queued/processing DocumentProcessingJob — what
 * the pipeline Inbox tab's inline spinner (documentStage's `hasActiveJob`) is driven by. */
export async function activeJobDocumentIds(workspaceId: string, documentIds: string[]): Promise<Set<string>> {
  if (!documentIds.length) return new Set()
  const jobs = await prisma.documentProcessingJob.findMany({ where: { workspaceId, documentId: { in: documentIds }, status: { in: ["queued", "processing"] } }, select: { documentId: true } })
  return new Set(jobs.map((job) => job.documentId).filter((id): id is string => id !== null))
}

/** Archives/unarchives a batch of documents — the pipeline's "Move to Archive" / "Restore" bulk
 * action. A separate axis from `status` (see lib/documents/stages.ts), so this never touches
 * status/reviewedData/confidence — restoring a document lands it back exactly where its status
 * already placed it. */
export async function setDocumentsArchived(workspaceId: string, documentIds: string[], archived: boolean) {
  const result = await prisma.document.updateMany({ where: { workspaceId, id: { in: documentIds.slice(0, 100) } }, data: { archivedAt: archived ? new Date() : null } })
  return { updated: result.count }
}

/** Sets/clears the pipeline list's manual "look at this" flag. Attributable like a transcript
 * edit: flaggedAt and flaggedById are set or cleared together (see the schema's CHECK). */
export async function setDocumentsFlagged(workspaceId: string, documentIds: string[], flagged: boolean, actorId: string) {
  const result = await prisma.document.updateMany({ where: { workspaceId, id: { in: documentIds.slice(0, 100) } }, data: flagged ? { flaggedAt: new Date(), flaggedById: actorId } : { flaggedAt: null, flaggedById: null } })
  return { updated: result.count }
}

/** Fire-and-forget: diffs old vs new field values and records each real scalar correction (WP1.3's
 * few-shot memory). Only scalar (string/number/boolean) values are recorded — an array field like
 * line_items is not a "wrong value, corrected value" pair in any useful sense for a prompt example.
 * Never awaited by callers past the point their own write already committed: a missed correction
 * costs future prompt quality, never correctness of the write it rode in on. */
function recordFieldCorrectionsFromDiff(input: { workspaceId: string; templateCode: string | null; oldValues: Record<string, unknown>; newValues: Record<string, unknown> }): void {
  if (!input.templateCode) return
  const templateCode = input.templateCode
  const supplierField = SUPPLIER_FIELD_BY_TEMPLATE[templateCode]
  const supplier = supplierField ? asScalarString(input.newValues[supplierField]) ?? asScalarString(input.oldValues[supplierField]) : null

  for (const [fieldKey, oldValue] of Object.entries(input.oldValues)) {
    const wrongValue = asScalarString(oldValue)
    if (wrongValue === null) continue
    const newValue = asScalarString(input.newValues[fieldKey])
    if (newValue === null || newValue === wrongValue) continue
    recordFieldCorrection({ workspaceId: input.workspaceId, templateCode, fieldKey, supplier, wrongValue, correctedValue: newValue })
      .catch((error) => console.error("[documents] failed to record field correction:", error instanceof Error ? error.message : error))
  }
}

function asScalarString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return null
}

export async function updateDocumentReview(input: { workspaceId: string; documentId: string; reviewedData: Record<string, unknown>; actorId: string }) {
  const document = await getWorkspaceDocument(input.workspaceId, input.documentId)
  if (!document) throw new Error("document_not_found")
  const fields = parseTemplateFields(document.fieldSnapshot)
  const reviewedData = validateDocumentValues(fields, input.reviewedData)
  const missing = findMissingRequiredFields(fields, reviewedData)
  // Re-project the structured spine from the values a human signed off on. Source is "manual"
  // because these are now reviewed values, but the per-field scores are carried over from the
  // extraction rather than being reset to 1: a bulk "mark reviewed" does not mean somebody read
  // every field, and claiming certainty nobody asserted would make the confidence signal useless.
  const priorConfidence = ((document.confidence as Record<string, unknown> | null)?.fieldConfidence as Record<string, number> | null) ?? null
  const rows = projectDocumentFields({ fields, values: reviewedData, confidence: priorConfidence, provenance: document.provenance as DocumentProvenance | null, source: "manual" })
  let webhookQueued = false
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.document.update({ where: { id: document.id }, data: { reviewedData: reviewedData as Prisma.InputJsonValue, searchText: searchableText(reviewedData, document.filename), confidence: { missingRequiredFields: missing, manuallyReviewed: true } as Prisma.InputJsonValue, reviewedAt: new Date(), status: missing.length ? "needs_review" : "reviewed" } })
    await recordDocumentAudit({ workspaceId: input.workspaceId, documentId: document.id, actorId: input.actorId, type: "document_reviewed" }, tx)
    await replaceDocumentFieldValues({ workspaceId: input.workspaceId, documentId: document.id, fileId: document.fileId, templateCode: document.template?.code ?? null, rows }, tx)
    const emitted = await emitWorkspaceEvent(tx, {
      workspaceId: input.workspaceId, type: missing.length ? "document.needs_review" : "document.reviewed", createdAt: new Date(),
      document: { id: updated.id, filename: updated.filename, status: updated.status, receivedAt: updated.receivedAt, reviewedData: updated.reviewedData, templateCode: document.template?.code ?? null, confidence: updated.confidence },
    })
    webhookQueued = emitted.queued > 0
    return updated
  }, { timeout: 20_000 })
  recordFieldCorrectionsFromDiff({
    workspaceId: input.workspaceId, templateCode: document.template?.code ?? null,
    oldValues: (document.reviewedData as Record<string, unknown> | null) ?? (document.rawExtraction as Record<string, unknown> | null) ?? {},
    newValues: reviewedData,
  })
  // Human review is the key integration trigger — a reviewed document is what a connector pushes.
  if (webhookQueued) await kickWebhookDrain()
  return result
}

/** Removes one field's source pin from a document's provenance record, returning the partial
 * update to merge into a document.update — or an empty object when there is nothing to clear, so
 * a document that never carried provenance is left untouched. */
function clearFieldProvenance(provenance: unknown, fieldKey: string): { provenance?: Prisma.InputJsonValue } {
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) return {}
  const prev = provenance as { fields?: Record<string, unknown>; items?: Record<string, unknown> }
  const fields = { ...(prev.fields ?? {}) }
  const items = { ...(prev.items ?? {}) }
  if (!(fieldKey in fields) && !(fieldKey in items)) return {}
  delete fields[fieldKey]
  delete items[fieldKey]
  return { provenance: { ...prev, fields, items } as Prisma.InputJsonValue }
}

/** actorId is nullable because a link-shared editor has no account of their own; the audit
 * event still records that the edit happened. */
export async function updateDocumentField(input: { workspaceId: string; documentId: string; fieldKey: string; value: unknown; actorId: string | null }) {
  const document = await getWorkspaceDocument(input.workspaceId, input.documentId)
  if (!document) throw new Error("document_not_found")
  if (document.status === "queued" || document.status === "failed") throw new Error("document_not_ready")
  const fields = parseTemplateFields(document.fieldSnapshot)
  if (!fields.some((f) => f.key === input.fieldKey)) throw new Error("unknown_field")
  const current = (document.reviewedData as Record<string, unknown> | null) ?? (document.rawExtraction as Record<string, unknown> | null) ?? {}
  const candidate = { ...current }
  if (input.value === null || input.value === "") { delete candidate[input.fieldKey] } else { candidate[input.fieldKey] = input.value }
  const reviewedData = validateDocumentValues(fields, candidate)
  const missing = findMissingRequiredFields(fields, reviewedData)
  const prevConfidence = (document.confidence as Record<string, unknown> | null) ?? {}
  const prevFieldConfidence = (prevConfidence.fieldConfidence as Record<string, number> | null) ?? {}
  const nextFieldConfidence = { ...prevFieldConfidence, [input.fieldKey]: 1 }
  const confidence = { ...prevConfidence, missingRequiredFields: missing, fieldConfidence: nextFieldConfidence } as Prisma.InputJsonValue
  // A hand-edited value no longer came from the document, so its source pin is dropped — a stale
  // highlight over the old printed value would be worse than none.
  const provenanceUpdate = clearFieldProvenance(document.provenance, input.fieldKey)
  // Re-project the whole document rather than the one edited field: the projection is a pure
  // function of the values, so replacing it wholesale is both simpler and immune to the drift a
  // targeted patch would eventually introduce. The edited field's confidence is 1 (a person typed
  // it) and its provenance was just cleared above, so it projects with no source pin.
  const nextProvenance = ("provenance" in provenanceUpdate ? provenanceUpdate.provenance : document.provenance) as DocumentProvenance | null
  const rows = projectDocumentFields({ fields, values: reviewedData, confidence: nextFieldConfidence, provenance: nextProvenance, source: "manual" })
  const updated = await prisma.$transaction(async (tx) => {
    const document_ = await tx.document.update({ where: { id: document.id }, data: { reviewedData: reviewedData as Prisma.InputJsonValue, searchText: searchableText(reviewedData, document.filename), confidence, ...provenanceUpdate } })
    await recordDocumentAudit({ workspaceId: input.workspaceId, documentId: document.id, actorId: input.actorId, type: "document_field_edited" }, tx)
    await replaceDocumentFieldValues({ workspaceId: input.workspaceId, documentId: document.id, fileId: document.fileId, templateCode: document.template?.code ?? null, rows }, tx)
    return document_
  }, { timeout: 20_000 })
  recordFieldCorrectionsFromDiff({ workspaceId: input.workspaceId, templateCode: document.template?.code ?? null, oldValues: current, newValues: reviewedData })
  await track("document_correction_saved", { documentId: document.id, fieldCount: 1 }, { workspaceId: input.workspaceId, actorId: input.actorId })
  return { document: updated, missingRequiredFields: missing }
}

/** Sets a document's coding (account/tax code/cost centre — whatever keys the workspace's
 * supplier rules use) directly, bypassing rule matching. Written by the finance agent's
 * set_document_coding act tool (Part 5c) when a person accepts the proposed coding, and available
 * to any future manual-coding UI. Deliberately touches ONLY `codingData` — never reviewedData,
 * confidence, or provenance, which is what `updateDocumentField` guards; coding is classification
 * metadata layered on top of extraction, not a value read off the document, so it has none of
 * that machinery to keep in sync. `appliedRuleId` is left untouched: this is coding a person (or
 * the agent, on their behalf) chose, not a rule matching, so it must not look like one did. */
export async function setDocumentCoding(input: { workspaceId: string; documentId: string; codingData: Record<string, string | number>; actorId: string }) {
  const document = await prisma.document.findFirst({ where: { id: input.documentId, workspaceId: input.workspaceId }, select: { id: true } })
  if (!document) throw new Error("document_not_found")
  const updated = await prisma.$transaction(async (tx) => {
    const document_ = await tx.document.update({ where: { id: document.id }, data: { codingData: input.codingData as Prisma.InputJsonValue } })
    await recordDocumentAudit({ workspaceId: input.workspaceId, documentId: document.id, actorId: input.actorId, type: "document_coding_set", detail: { codingData: input.codingData } }, tx)
    return document_
  })
  return updated
}

export async function markDocumentsReviewed(workspaceId: string, documentIds: string[], actorId: string) {
  const capped = documentIds.slice(0, 100)
  let reviewed = 0
  let needsReview = 0
  for (const documentId of capped) {
    const doc = await getWorkspaceDocument(workspaceId, documentId)
    if (!doc || doc.status === "queued" || doc.status === "failed") continue
    const data = (doc.reviewedData as Record<string, unknown> | null) ?? (doc.rawExtraction as Record<string, unknown> | null) ?? {}
    try {
      await updateDocumentReview({ workspaceId, documentId, reviewedData: data, actorId })
      const fields = parseTemplateFields(doc.fieldSnapshot)
      const missing = findMissingRequiredFields(fields, validateDocumentValues(fields, data))
      if (missing.length) { needsReview++ } else { reviewed++ }
    } catch { needsReview++ }
  }
  return { reviewed, needsReview }
}

/** Lightweight status read for the extraction-progress poller. Capped because callers track
 * one upload batch, not the whole workspace. `searchable` reports whether the document has any
 * stored chunks yet — true once embedding has run — and is only computed when document search is
 * configured; with the feature off it is always false, so nothing downstream ever shows the chip.
 * `flaggedFields` names every field a reviewer should double-check: missing required fields plus
 * any field the model returned below the same LOW_CONFIDENCE threshold the sheet's amber tint
 * uses — so the same signal the grid already carries also reaches the extract panel's row list. */
export function flaggedFieldsFromConfidence(confidence: unknown): string[] {
  const record = (confidence as Record<string, unknown> | null) ?? null
  const missing = (record?.missingRequiredFields as string[] | null) ?? []
  const fieldConfidence = (record?.fieldConfidence as Record<string, number> | null) ?? {}
  const low = Object.entries(fieldConfidence).filter(([, score]) => typeof score === "number" && score < LOW_CONFIDENCE).map(([key]) => key)
  return [...new Set([...missing, ...low])]
}

export async function getDocumentsStatus(workspaceId: string, documentIds: string[]) {
  if (!documentIds.length) return []
  const where = { workspaceId, id: { in: documentIds.slice(0, 50) } }
  // With document search off, skip the chunk-count join entirely and report searchable: false.
  if (!config.embeddings.enabled) {
    const rows = await prisma.document.findMany({ where, select: { id: true, status: true, errorCode: true, filename: true, confidence: true } })
    return rows.map(({ confidence, ...row }) => ({ ...row, searchable: false, indexing: false, flaggedFields: flaggedFieldsFromConfidence(confidence) }))
  }
  const rows = await prisma.document.findMany({
    where,
    select: {
      id: true, status: true, errorCode: true, filename: true, confidence: true,
      _count: { select: { chunks: true } },
      // Was implied — a poller had to guess indexing was still happening from "not searchable
      // yet" and a fixed tick budget. This makes it a fact: a queued/processing embed job exists,
      // full stop, rather than something inferred from the absence of a result.
      jobs: { where: { type: "embed", status: { in: ["queued", "processing"] } }, select: { id: true }, take: 1 },
    },
  })
  return rows.map(({ _count, jobs, confidence, ...row }) => ({ ...row, searchable: _count.chunks > 0, indexing: jobs.length > 0, flaggedFields: flaggedFieldsFromConfidence(confidence) }))
}

/** Deletes documents with their stored sources. Quota is deliberately not refunded: the
 * upload consumed processing work, and refunds would let one slot be recycled all month. */
export async function deleteWorkspaceDocuments(workspaceId: string, documentIds: string[], actorId: string) {
  const documents = await prisma.document.findMany({ where: { workspaceId, id: { in: documentIds.slice(0, 100) } }, select: { id: true, storageKey: true, filename: true } })
  let deleted = 0
  let anyQueued = false
  for (const document of documents) {
    if (document.storageKey) await deleteDocumentSource(document.storageKey).catch(() => {})
    // The blocks sidecar (if any) sits under the same document prefix; drop it too. Best effort —
    // an absent sidecar is the common case.
    await deleteDocumentSource(documentBlocksKey(workspaceId, document.id)).catch(() => {})
    // Interactive form so document.deleted fans out in the same tx as the delete. The event carries
    // only id + filename (the row is gone), and its delivery row's documentId is null — no dangling FK.
    // Context fetched before the tx: recordDocumentAudit's getRequestAuditContext() reads next/headers(),
    // which only works outside a transaction callback (it is not a lazy Prisma query).
    const context = await getRequestAuditContext()
    await prisma.$transaction(async (tx) => {
      await tx.document.delete({ where: { id: document.id } })
      await tx.documentAuditEvent.create({ data: auditEventData({ workspaceId, actorId, type: "document_deleted" }, context) })
      const emitted = await emitWorkspaceEvent(tx, {
        workspaceId, type: "document.deleted", createdAt: new Date(),
        document: { id: document.id, filename: document.filename, deleted: true },
      })
      if (emitted.queued > 0) anyQueued = true
    })
    deleted++
  }
  if (anyQueued) await kickWebhookDrain()
  return { deleted }
}

/** Re-runs extraction for one document (the panel's re-process action). The AI quota flag
 * stays claimed, so a re-run never double-charges the workspace. */
export async function requeueDocumentExtraction(workspaceId: string, documentId: string) {
  const document = await prisma.document.findFirst({ where: { id: documentId, workspaceId }, select: { id: true, storageKey: true } })
  if (!document) throw new Error("document_not_found")
  if (!document.storageKey) throw new Error("document_source_missing")
  const active = await prisma.documentProcessingJob.findFirst({ where: { documentId: document.id, status: { in: ["queued", "processing"] } }, select: { id: true } })
  if (active) throw new Error("document_already_processing")
  const context = await getRequestAuditContext()
  const [, job] = await prisma.$transaction([
    prisma.document.update({ where: { id: document.id }, data: { status: "queued", errorCode: null } }),
    prisma.documentProcessingJob.create({ data: { workspaceId, documentId: document.id, type: "extract" } }),
    prisma.documentAuditEvent.create({ data: auditEventData({ workspaceId, documentId: document.id, type: "extraction_requeued" }, context) }),
  ])
  return job
}

export function documentDataForExport(document: Pick<Document, "filename" | "status" | "receivedAt" | "reviewedData">) {
  return { filename: document.filename, status: document.status, received_at: document.receivedAt.toISOString(), ...((document.reviewedData as Record<string, unknown> | null) || {}) }
}

/** Sets (or clears, on an empty string) the split-pane detail view's free-text note. */
export async function updateDocumentNote(workspaceId: string, documentId: string, note: string) {
  const trimmed = note.trim()
  await prisma.document.update({ where: { id: documentId, workspaceId }, data: { note: trimmed || null } })
  return { note: trimmed || null }
}

/** Merges exactly two documents on the pipeline list — the "duplicate scans of one invoice"
 * case. The earlier-received document survives; any field the survivor is missing is backfilled
 * from the other before it is deleted. Works across a `fileId` difference on purpose: dedup
 * (`@@unique([fileId, sha256])`) is per file, so a real duplicate uploaded into two different
 * files never trips it, and this is the tool for merging that pair by hand. */
export async function mergeDocuments(workspaceId: string, documentIds: [string, string], actorId: string) {
  const [a, b] = await Promise.all(documentIds.map((id) => getWorkspaceDocument(workspaceId, id)))
  if (!a || !b) throw new Error("document_not_found")
  const [survivor, loser] = a.receivedAt <= b.receivedAt ? [a, b] : [b, a]
  const survivorData = (survivor.reviewedData as Record<string, unknown> | null) ?? (survivor.rawExtraction as Record<string, unknown> | null) ?? {}
  const loserData = (loser.reviewedData as Record<string, unknown> | null) ?? (loser.rawExtraction as Record<string, unknown> | null) ?? {}
  const merged = { ...loserData, ...survivorData }
  await updateDocumentReview({ workspaceId, documentId: survivor.id, reviewedData: merged, actorId })
  await deleteWorkspaceDocuments(workspaceId, [loser.id], actorId)
  return { survivorId: survivor.id }
}
