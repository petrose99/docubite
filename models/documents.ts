import config from "@/lib/config"
import { findMissingRequiredFields, parseTemplateFields, validateDocumentValues } from "@/lib/document-templates"
import { deleteDocumentSource, documentBlocksKey, documentStorageKey, putDocumentSource } from "@/lib/document-storage"
import { consumeWorkspaceQuota } from "@/models/workspaces"
import { documentFieldValueSyncOps } from "@/models/document-values"
import { prisma } from "@/lib/db"
import { Document, Prisma } from "@/prisma/client"
import crypto from "crypto"
import path from "path"
import { randomUUID } from "crypto"

const SUPPORTED_DOCUMENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"])
export type DocumentSource = "upload"

export const documentHash = (buffer: Buffer) => crypto.createHash("sha256").update(buffer).digest("hex")

function cleanFilename(filename: string) {
  const sanitized = path.basename(filename).replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim()
  return (sanitized || "document").slice(0, 255)
}

export function isSupportedDocumentBuffer(buffer: Buffer, mimeType: string) {
  if (!SUPPORTED_DOCUMENT_TYPES.has(mimeType)) return false
  if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-"
  if (mimeType === "image/jpeg") return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mimeType === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP"
  return buffer.subarray(4, 8).toString("ascii") === "ftyp"
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

  await consumeWorkspaceQuota(input.workspaceId, "document")
  const id = randomUUID()
  const storageKey = documentStorageKey(input.workspaceId, id)
  const receivedAt = input.receivedAt || new Date()
  await putDocumentSource(storageKey, input.buffer, input.mimeType)
  try {
    return await prisma.$transaction(async (tx) => {
      const document = await tx.document.create({ data: {
        id, workspaceId: input.workspaceId, fileId: input.fileId, templateId: template.id, templateVersionId: version.id, source: input.source,
        status: "queued", filename: cleanFilename(input.filename), mimeType: input.mimeType, sizeBytes: input.buffer.length,
        sha256, storageKey, receivedAt, pageRange: input.pageRange?.trim() || null, uploadBatchId: input.uploadBatchId || null,
        fieldSnapshot: version.fields as Prisma.InputJsonValue, searchText: cleanFilename(input.filename),
      } })
      const job = await tx.documentProcessingJob.create({ data: { workspaceId: input.workspaceId, documentId: document.id, type: "extract" } })
      await tx.documentAuditEvent.create({ data: { workspaceId: input.workspaceId, documentId: document.id, type: "document_received" } })
      return { document, job, duplicate: false }
    })
  } catch (error) {
    await deleteDocumentSource(storageKey)
    throw error
  }
}

export async function listWorkspaceDocuments(workspaceId: string, filters: { status?: string; query?: string; templateId?: string; fileId?: string } = {}) {
  const where: Prisma.DocumentWhereInput = { workspaceId, ...(filters.fileId ? { fileId: filters.fileId } : {}), ...(filters.status && filters.status !== "all" ? { status: filters.status } : {}), ...(filters.query?.trim() ? { OR: [{ searchText: { contains: filters.query.trim(), mode: "insensitive" as const } }, { ocrText: { contains: filters.query.trim(), mode: "insensitive" as const } }] } : {}), ...(filters.templateId ? { templateId: filters.templateId } : {}) }
  return prisma.document.findMany({ where, include: { template: true, templateVersion: true }, orderBy: { receivedAt: "desc" }, take: 100 })
}

export const getWorkspaceDocument = (workspaceId: string, documentId: string) => prisma.document.findFirst({ where: { id: documentId, workspaceId }, include: { template: true, templateVersion: true } })

export async function updateDocumentReview(input: { workspaceId: string; documentId: string; reviewedData: Record<string, unknown>; actorId: string }) {
  const document = await getWorkspaceDocument(input.workspaceId, input.documentId)
  if (!document) throw new Error("document_not_found")
  const fields = parseTemplateFields(document.fieldSnapshot)
  const reviewedData = validateDocumentValues(fields, input.reviewedData)
  const missing = findMissingRequiredFields(fields, reviewedData)
  return prisma.$transaction([
    prisma.document.update({ where: { id: document.id }, data: { reviewedData: reviewedData as Prisma.InputJsonValue, searchText: searchableText(reviewedData, document.filename), confidence: { missingRequiredFields: missing, manuallyReviewed: true } as Prisma.InputJsonValue, reviewedAt: new Date(), status: missing.length ? "needs_review" : "reviewed" } }),
    ...documentFieldValueSyncOps(document, reviewedData),
    prisma.documentAuditEvent.create({ data: { workspaceId: input.workspaceId, documentId: document.id, actorId: input.actorId, type: "document_reviewed" } }),
  ])
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
export async function updateDocumentField(input: { workspaceId: string; documentId: string; fieldKey: string; value: unknown; actorId: string | null; auditType?: string }) {
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
  const confidence = { ...prevConfidence, missingRequiredFields: missing, fieldConfidence: { ...prevFieldConfidence, [input.fieldKey]: 1 } } as Prisma.InputJsonValue
  // A hand-edited value no longer came from the document, so its source pin is dropped — a stale
  // highlight over the old printed value would be worse than none.
  const provenanceUpdate = clearFieldProvenance(document.provenance, input.fieldKey)
  const [updated] = await prisma.$transaction([
    prisma.document.update({ where: { id: document.id }, data: { reviewedData: reviewedData as Prisma.InputJsonValue, searchText: searchableText(reviewedData, document.filename), confidence, ...provenanceUpdate } }),
    ...documentFieldValueSyncOps(document, reviewedData),
    prisma.documentAuditEvent.create({ data: { workspaceId: input.workspaceId, documentId: document.id, actorId: input.actorId, type: input.auditType ?? "document_field_edited" } }),
  ])
  return { document: updated, missingRequiredFields: missing }
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
 * one upload batch, not the whole workspace. */
export async function getDocumentsStatus(workspaceId: string, documentIds: string[]) {
  if (!documentIds.length) return []
  return prisma.document.findMany({ where: { workspaceId, id: { in: documentIds.slice(0, 50) } }, select: { id: true, status: true, errorCode: true, filename: true } })
}

/** Deletes documents with their stored sources. Quota is deliberately not refunded: the
 * upload consumed processing work, and refunds would let one slot be recycled all month. */
export async function deleteWorkspaceDocuments(workspaceId: string, documentIds: string[], actorId: string) {
  const documents = await prisma.document.findMany({ where: { workspaceId, id: { in: documentIds.slice(0, 100) } }, select: { id: true, storageKey: true } })
  let deleted = 0
  for (const document of documents) {
    if (document.storageKey) await deleteDocumentSource(document.storageKey).catch(() => {})
    // The blocks sidecar (if any) sits under the same document prefix; drop it too. Best effort —
    // an absent sidecar is the common case.
    await deleteDocumentSource(documentBlocksKey(workspaceId, document.id)).catch(() => {})
    await prisma.$transaction([
      prisma.document.delete({ where: { id: document.id } }),
      prisma.documentAuditEvent.create({ data: { workspaceId, actorId, type: "document_deleted" } }),
    ])
    deleted++
  }
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
  const [, job] = await prisma.$transaction([
    prisma.document.update({ where: { id: document.id }, data: { status: "queued", errorCode: null } }),
    prisma.documentProcessingJob.create({ data: { workspaceId, documentId: document.id, type: "extract" } }),
    prisma.documentAuditEvent.create({ data: { workspaceId, documentId: document.id, type: "extraction_requeued" } }),
  ])
  return job
}

export function documentDataForExport(document: Pick<Document, "filename" | "status" | "receivedAt" | "reviewedData">) {
  return { filename: document.filename, status: document.status, received_at: document.receivedAt.toISOString(), ...((document.reviewedData as Record<string, unknown> | null) || {}) }
}
