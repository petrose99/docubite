// Deliberately NOT a "use server" module, matching models/files.ts and models/documents.ts: this
// trusts the workspaceId/fileId/templateId it is handed. Callers (upload/zip server actions,
// future email/API intake) do the auth.
import { track } from "@/lib/analytics"
import { scanDocumentBuffer } from "@/lib/malware-scan"
import { prisma } from "@/lib/db"
import { createDocumentFromBuffer, documentHash, type DocumentSource } from "@/models/documents"
import type { IngestionItem } from "@/prisma/client"

export type IngestionSource = "upload" | "camera" | "email" | "zip" | "api"

export type IngestionResult =
  | { outcome: "duplicate"; item: IngestionItem }
  | { outcome: "rejected"; item: IngestionItem; errorCode: string }
  | { outcome: "accepted"; item: IngestionItem; document: Awaited<ReturnType<typeof createDocumentFromBuffer>>["document"]; job: Awaited<ReturnType<typeof createDocumentFromBuffer>>["job"]; duplicateInFile: boolean }

/** Every intake channel funnels through here — the single place that turns raw bytes into either
 * a Document or a recorded reason there isn't one. Three things happen in order, each able to
 * short-circuit the rest:
 *
 * 1. Workspace-wide idempotency: the same bytes ingested twice (a re-sent email, a re-uploaded
 *    ZIP after a network blip) resolve to the existing IngestionItem rather than a second attempt
 *    at the whole pipeline. This is deliberately broader than Document's own (fileId, sha256)
 *    uniqueness, which is scoped to one file for a different reason (the same PDF may legitimately
 *    be extracted into two different files).
 * 2. Malware scan. A rejection here is recorded, never thrown past this function — a batch upload
 *    (see lib/zip-ingestion.ts) must be able to accept 49 clean files from a ZIP that had one
 *    infected entry, not abort the whole thing.
 * 3. The existing Document pipeline (models/documents.ts::createDocumentFromBuffer), unchanged —
 *    this wraps it, never replaces it. A failure there (quota exhausted, unknown template) is
 *    recorded the same way a malware rejection is. */
export async function createIngestionItem(input: {
  workspaceId: string
  fileId: string
  templateId: string
  source: IngestionSource
  filename: string
  mimeType: string
  buffer: Buffer
  pageRange?: string | null
  uploadBatchId?: string | null
}): Promise<IngestionResult> {
  const idempotencyKey = documentHash(input.buffer)
  const key = { workspaceId_idempotencyKey: { workspaceId: input.workspaceId, idempotencyKey } } as const

  const existing = await prisma.ingestionItem.findUnique({ where: key })
  // Only a *successful* prior ingestion short-circuits. A previous attempt that was rejected or
  // failed left no Document behind, so silently treating a retry as "duplicate" would permanently
  // block re-upload of those exact bytes after nothing but a transient scanner outage — the retry
  // below re-attempts instead, upserting the same row rather than colliding on the unique key.
  if (existing?.documentId) return { outcome: "duplicate", item: existing }

  const upsertItem = (data: { documentId?: string; malwareStatus: string; status: string; errorCode?: string | null }) =>
    prisma.ingestionItem.upsert({
      where: key,
      create: { workspaceId: input.workspaceId, fileId: input.fileId, source: input.source, idempotencyKey, attempts: 1, ...data },
      update: { attempts: { increment: 1 }, ...data },
    })

  try {
    await scanDocumentBuffer(input.buffer, input.mimeType)
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : "malware_scan_failed"
    const item = await upsertItem({ malwareStatus: errorCode === "malware_detected" ? "infected" : "scan_failed", status: "rejected", errorCode })
    return { outcome: "rejected", item, errorCode }
  }

  // Document.source only distinguishes "upload" from "dictation" (models/documents.ts) — every
  // other intake channel is an upload as far as the Document row is concerned. IngestionItem is
  // what remembers which channel it actually arrived through.
  const documentSource: DocumentSource = input.source === "camera" || input.source === "email" || input.source === "zip" || input.source === "api" ? "upload" : input.source

  try {
    const result = await createDocumentFromBuffer({
      workspaceId: input.workspaceId, fileId: input.fileId, templateId: input.templateId, source: documentSource,
      filename: input.filename, mimeType: input.mimeType, buffer: input.buffer,
      pageRange: input.pageRange, uploadBatchId: input.uploadBatchId,
    })
    const item = await upsertItem({ documentId: result.document.id, malwareStatus: "clean", status: result.duplicate ? "duplicate" : "extracting", errorCode: null })
    if (!result.duplicate) await track("document_uploaded", { fileId: input.fileId, documentId: result.document.id, source: input.source }, { workspaceId: input.workspaceId })
    return { outcome: "accepted", item, document: result.document, job: result.job, duplicateInFile: result.duplicate }
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : "ingestion_failed"
    const item = await upsertItem({ malwareStatus: "clean", status: "failed", errorCode })
    return { outcome: "rejected", item, errorCode }
  }
}
