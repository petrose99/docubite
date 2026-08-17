import { requestLLM } from "@/ai/providers/llmProvider"
import config from "@/lib/config"
import { buildDocumentJsonSchema, buildDocumentPrompt, DocumentClassification, DocumentFieldDefinition, extractClassification, extractFieldConfidence, extractFieldProvenance, FieldProvenanceHints, findMissingRequiredFields, parseTemplateFields, ProvenanceHint, validateDocumentValues } from "@/lib/document-templates"
import { documentBlocksKey, putDocumentSource, readDocumentSource } from "@/lib/document-storage"
import { buildBlocksSidecar, buildDocumentProvenance } from "@/lib/provenance"
import { buildShapeSignature } from "@/lib/shape-match"
import { searchableText } from "@/models/documents"
import { documentFieldValueSyncOps } from "@/models/document-values"
import { upsertExtractionShape } from "@/models/extraction-shapes"
import { scanDocumentBuffer } from "@/lib/malware-scan"
import { parseDocumentWithMineru } from "@/lib/mineru"
import { parsePageRange } from "@/lib/page-range"
import { prisma } from "@/lib/db"
import { consumeWorkspaceQuota } from "@/models/workspaces"
import { Prisma } from "@/prisma/client"
import sharp from "sharp"

const PROCESSABLE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"])
/** What MinerU itself accepts. The two formats we take but it does not are converted below. */
const MINERU_NATIVE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"])
const JOB_LEASE_MS = 14 * 60 * 1000
const OCR_TEXT_LIMIT = 100_000

/** Error codes that will fail identically on every retry, so the job is failed immediately
 * instead of burning its five attempts. */
export const PERMANENT_ERROR_CODES = [
  "document_source_missing",
  "pdf_page_limit_exceeded",
  "invalid_page_range",
  "page_range_matched_no_pages",
  "mineru_file_too_large",
  "mineru_page_limit_exceeded",
  "mineru_not_configured",
]

function safeErrorCode(error: unknown) {
  const raw = error instanceof Error ? error.message : "processing_failed"
  return raw.replace(/[^a-z0-9_]/gi, "_").slice(0, 96).toLowerCase()
}

function pdfPageCount(source: Buffer) {
  return (source.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length
}

export function pageBatches(pageCount: number, batchSize: number) {
  const batches: number[][] = []
  for (let start = 1; start <= pageCount; start += batchSize) {
    const end = Math.min(start + batchSize - 1, pageCount)
    batches.push(Array.from({ length: end - start + 1 }, (_, index) => start + index))
  }
  return batches
}

/** One page of the document as parsed markdown. */
export type PageContent = { page: number; text: string }

/** Splits one batch's pages into the LLM request's text parts. */
export function buildBatchParts(contents: PageContent[], pageNumbers: number[]) {
  const inBatch = contents.filter((content) => pageNumbers.includes(content.page))
  return {
    textParts: inBatch.map((content) => `--- Page ${content.page} (parsed document text, markdown; may contain recognition errors) ---\n${content.text}`),
  }
}

/** MinerU takes pdf/jpeg/png but not the webp and heic uploads we accept, so those are
 * re-encoded to PNG first. `.rotate()` applies the EXIF orientation phone photos carry, which
 * a format conversion would otherwise drop and leave the page sideways. */
export async function normalizeForMineru(source: Buffer, mimeType: string, filename: string): Promise<{ buffer: Buffer; filename: string }> {
  if (MINERU_NATIVE_TYPES.has(mimeType)) return { buffer: source, filename }
  return { buffer: await sharp(source).rotate().png().toBuffer(), filename: `${filename.replace(/\.[^.]*$/, "")}.png` }
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== ""
}

function arrayRows(pass: Record<string, unknown>, key: string) {
  return Array.isArray(pass[key]) ? (pass[key] as unknown[]) : []
}

/** Which pass a scalar field's merged value comes from, or -1 when no pass reported one.
 * Header fields keep the first non-empty value, since page 1 is where they are printed. A
 * field marked mergeStrategy "last" reads in reverse instead: an invoice's totals row sits
 * below the line items it totals, so the batch that reached it outranks an earlier batch
 * that could only add up the lines on its own pages. Batches that reported nothing are
 * skipped either way, so a trailing terms-and-conditions page cannot blank out a total. */
function winningPassIndex(field: DocumentFieldDefinition, passes: Array<Record<string, unknown>>) {
  const order = passes.map((_, index) => index)
  if (field.mergeStrategy === "last") order.reverse()
  return order.find((index) => hasValue(passes[index][field.key])) ?? -1
}

/** Merges per-batch extraction passes for one document. Scalar fields resolve by their
 * mergeStrategy (see winningPassIndex); array fields concatenate across batches so a
 * line-item table spanning many pages comes through whole. */
export function mergeExtractionPasses(fields: DocumentFieldDefinition[], passes: Array<Record<string, unknown>>) {
  const merged: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.type === "array") {
      const combined = passes.flatMap((pass) => arrayRows(pass, field.key))
      if (combined.length) merged[field.key] = combined
      continue
    }
    const index = winningPassIndex(field, passes)
    if (index >= 0) merged[field.key] = passes[index][field.key]
  }
  return merged
}

/** Scalar fields where two passes reported different non-empty values, so merging had to
 * discard one of them. Usually one batch never saw the page the value is printed on and
 * inferred it from what it could see; either way the merged value is a pick between
 * readings rather than a single reading, and is worth a reviewer's eyes. */
export function findConflictingScalarFields(fields: DocumentFieldDefinition[], passes: Array<Record<string, unknown>>) {
  return fields
    .filter((field) => field.type !== "array" && new Set(passes.map((pass) => pass[field.key]).filter(hasValue)).size > 1)
    .map((field) => field.key)
}

/** Merges per-batch confidence scores, reading each one from the pass that supplied the
 * merged value so the score always describes the value stored next to it. Array fields have
 * no single winning pass, so they take the first score from a pass that contributed rows. */
export function mergeFieldConfidence(fields: DocumentFieldDefinition[], passes: Array<Record<string, unknown>>, confidencePasses: Array<Record<string, number>>) {
  const merged: Record<string, number> = {}
  for (const field of fields) {
    const sources = field.type === "array"
      ? passes.flatMap((pass, index) => (arrayRows(pass, field.key).length ? [index] : []))
      : [winningPassIndex(field, passes)].filter((index) => index >= 0)
    const source = sources.find((index) => typeof confidencePasses[index]?.[field.key] === "number")
    if (source !== undefined) merged[field.key] = confidencePasses[source][field.key]
  }
  return merged
}

/** Merges per-batch provenance hints the same way the values are merged, so a hint always
 * describes the value stored next to it. Scalar hints come from the pass that won the value (see
 * winningPassIndex). Array hints concatenate in pass order, padded to each pass's row count with
 * null, so they stay index-aligned with the rows mergeExtractionPasses concatenated. */
export function mergeProvenancePasses(fields: DocumentFieldDefinition[], passes: Array<Record<string, unknown>>, provenancePasses: FieldProvenanceHints[]): FieldProvenanceHints {
  const merged: FieldProvenanceHints = { fields: {}, items: {} }
  for (const field of fields) {
    if (field.type === "array") {
      const combined: (ProvenanceHint | null)[] = []
      let contributed = false
      passes.forEach((pass, index) => {
        const rowCount = arrayRows(pass, field.key).length
        if (!rowCount) return
        const hints = provenancePasses[index]?.items[field.key] ?? []
        for (let row = 0; row < rowCount; row++) {
          const hint = hints[row] ?? null
          combined.push(hint)
          if (hint) contributed = true
        }
      })
      if (contributed) merged.items[field.key] = combined
      continue
    }
    const winner = winningPassIndex(field, passes)
    if (winner < 0) continue
    const hint = provenancePasses[winner]?.fields[field.key]
    if (hint) merged.fields[field.key] = hint
  }
  return merged
}

/** Merges per-batch document classifications by taking the first non-empty value for each key —
 * doc_type, entity, and period all come off page 1, so the earliest batch to report one is right. */
export function mergeClassification(passes: DocumentClassification[]): DocumentClassification {
  const first = (pick: (pass: DocumentClassification) => string) => passes.map(pick).find((value) => value) ?? ""
  return { docType: first((pass) => pass.docType), entity: first((pass) => pass.entity), period: first((pass) => pass.period) }
}

export async function processDocumentJob(jobId: string) {
  const now = new Date()
  const claimed = await prisma.documentProcessingJob.updateMany({
    where: { id: jobId, status: "queued", scheduledAt: { lte: now } },
    data: { status: "processing", attempts: { increment: 1 }, startedAt: now, leaseUntil: new Date(now.getTime() + JOB_LEASE_MS), errorCode: null },
  })
  if (!claimed.count) return
  const job = await prisma.documentProcessingJob.findUnique({ where: { id: jobId }, include: { document: { include: { workspace: true, template: true, templateVersion: true } } } })
  if (!job?.document) throw new Error("document_job_not_found")
  const document = job.document
  try {
    if (!document.storageKey) throw new Error("document_source_missing")
    if (!PROCESSABLE_TYPES.has(document.mimeType)) throw new Error("unsupported_document_type")
    const source = await readDocumentSource(document.storageKey)
    await scanDocumentBuffer(source, document.mimeType)
    const fields = parseTemplateFields(document.fieldSnapshot)
    if (!document.workspace.aiEnabled) {
      await prisma.$transaction([
        prisma.document.update({ where: { id: document.id }, data: { status: "ready_for_review", reviewedData: {}, confidence: { aiEnabled: false } } }),
        // No values were extracted, so clear any this document carried from an earlier run.
        ...documentFieldValueSyncOps(document, {}),
        prisma.documentProcessingJob.update({ where: { id: job.id }, data: { status: "completed", completedAt: new Date(), leaseUntil: null } }),
      ])
      return
    }
    const isPdf = document.mimeType === "application/pdf"
    // A stored page range narrows extraction to the selected pages. It is parsed here only to
    // reject a malformed one before the upload — MinerU applies the range itself.
    const pageRanges = isPdf ? document.pageRange?.trim() || null : null
    const selectedPages = pageRanges ? new Set(parsePageRange(pageRanges) ?? []) : null
    // Cheap upfront reject on the estimated page count, so an oversized PDF is turned away
    // before it is uploaded. The real count is only known once MinerU returns, and is
    // re-checked against the limit below. A page range caps the work at its own size.
    const estimatedPages = isPdf ? pdfPageCount(source) || 1 : 1
    const estimatedWork = selectedPages?.size ? Math.min(estimatedPages, selectedPages.size) : estimatedPages
    if (isPdf && config.documents.maxPages > 0 && estimatedWork > config.documents.maxPages) throw new Error("pdf_page_limit_exceeded")

    if (!document.aiQuotaClaimed) {
      await consumeWorkspaceQuota(document.workspaceId, "ai")
      await prisma.document.update({ where: { id: document.id }, data: { aiQuotaClaimed: true } })
    }
    const aiProvider = config.ai.provider
    const apiKey = aiProvider === "gemini" ? config.ai.geminiApiKey : config.ai.openaiApiKey
    const modelName = aiProvider === "gemini" ? config.ai.geminiModelName : config.ai.openaiModelName
    if (!apiKey) throw new Error("platform_ai_not_configured")

    const renewLease = async () => {
      await prisma.documentProcessingJob.update({ where: { id: job.id }, data: { leaseUntil: new Date(Date.now() + JOB_LEASE_MS) } })
    }
    const upload = await normalizeForMineru(source, document.mimeType, document.filename)
    // The lease is renewed on every poll: MinerU can take minutes on a long document, and the
    // job would otherwise be reclaimed as expired while it is still legitimately running.
    const parsed = await parseDocumentWithMineru({ buffer: upload.buffer, filename: upload.filename, pageRanges, onPoll: renewLease })
    if (!parsed.markdown) throw new Error("page_range_matched_no_pages")
    // content_list.json is what carries page boundaries; without it the document is treated as
    // a single page, which costs batching but never loses text.
    const contents: PageContent[] = parsed.pages?.length ? parsed.pages : [{ page: 1, text: parsed.markdown }]
    const ocrText = parsed.markdown.slice(0, OCR_TEXT_LIMIT)

    // Batch over the pages actually parsed rather than the estimate: pdfPageCount reads 0
    // on PDFs whose page tree sits in a compressed object stream, and batching on that would
    // leave every page past the first out of all batches and silently unextracted.
    if (config.documents.maxPages > 0 && contents.length > config.documents.maxPages) throw new Error("pdf_page_limit_exceeded")
    // Parsed pages need not be numbered 1..N contiguously (a page with no readable content
    // produces no blocks at all), so remap the 1..N batch positions onto the pages that
    // actually exist in `contents`.
    const collectedPages = contents.map((content) => content.page)
    const batches = pageBatches(contents.length, config.documents.pagesPerBatch).map((batch) => batch.map((position) => collectedPages[position - 1]))
    const prompt = buildDocumentPrompt(document.template?.name || "document", fields, document.templateVersion?.prompt)
    const schema = buildDocumentJsonSchema(fields)
    const passes: Array<Record<string, unknown>> = []
    const confidencePasses: Array<Record<string, number>> = []
    const provenancePasses: FieldProvenanceHints[] = []
    const classificationPasses: DocumentClassification[] = []
    let batchFailures = 0
    for (let index = 0; index < batches.length; index++) {
      const { textParts } = buildBatchParts(contents, batches[index])
      const response = await requestLLM({ providers: [{ provider: aiProvider, apiKey, model: modelName }] }, { prompt, schema, textParts })
      if (response.error) batchFailures++
      else {
        passes.push(validateDocumentValues(fields, response.output))
        confidencePasses.push(extractFieldConfidence(fields, response.output))
        provenancePasses.push(extractFieldProvenance(fields, response.output))
        classificationPasses.push(extractClassification(response.output))
      }
      const isLastBatch = index === batches.length - 1
      if (!isLastBatch) await renewLease()
    }
    if (!passes.length) throw new Error("ai_extraction_failed")

    const extraction = mergeExtractionPasses(fields, passes)
    const fieldConfidence = mergeFieldConfidence(fields, passes, confidencePasses)
    const conflictingFields = findConflictingScalarFields(fields, passes)
    const missing = findMissingRequiredFields(fields, extraction)
    const classification = mergeClassification(classificationPasses)
    // Save this run's setup as a reusable shape and stamp the document with it, so the next
    // similar upload can be matched and this run can later be diffed against. Best effort: a
    // failed upsert simply leaves the document unshaped, never failing an otherwise-good extraction.
    let shapeId: string | null = null
    if (document.templateId && document.template) {
      const firstPageText = (contents.find((content) => content.page === 1)?.text ?? contents[0]?.text ?? "").slice(0, 4000)
      const signature = buildShapeSignature({ firstPageText, docType: classification.docType, entity: classification.entity })
      const shape = await upsertExtractionShape({
        workspaceId: document.workspaceId, templateId: document.templateId, name: document.template.name,
        docType: classification.docType || null, entity: classification.entity || null,
        fields: document.fieldSnapshot as Prisma.InputJsonValue, prompt: document.templateVersion?.prompt ?? null,
        multiRow: document.template.multiRow, signature, lastDocumentId: document.id,
      }).catch(() => null)
      shapeId = shape?.id ?? null
    }
    // Resolve each merged value's source location against the parsed blocks, remapping pages back
    // to the original numbering when a page range narrowed the parse.
    const provenance = buildDocumentProvenance(fields, mergeProvenancePasses(fields, passes, provenancePasses), extraction, parsed.blocks ?? null, parsed.pageSizes ?? null, pageRanges)
    // The parsed blocks are stored beside the source so provenance can be re-resolved later. Best
    // effort: the resolved provenance is already on the document, so a failed sidecar write costs
    // only future re-resolution, never this extraction.
    const sidecar = buildBlocksSidecar(parsed.blocks ?? null, parsed.pageSizes ?? null)
    if (sidecar) await putDocumentSource(documentBlocksKey(document.workspaceId, document.id), Buffer.from(JSON.stringify(sidecar)), "application/json").catch(() => {})
    const status = missing.length || batchFailures ? "needs_review" : "ready_for_review"
    await prisma.$transaction([
      // searchText is rebuilt from the extracted values here — without this it stays the bare
      // filename set at upload, and text search would miss everything until a manual review.
      prisma.document.update({ where: { id: document.id }, data: { status, ocrText, searchText: searchableText(extraction, document.filename), rawExtraction: extraction as Prisma.InputJsonValue, reviewedData: extraction as Prisma.InputJsonValue, provenance: provenance as Prisma.InputJsonValue, shapeId, classification: classification as Prisma.InputJsonValue, confidence: { missingRequiredFields: missing, partialFailure: batchFailures > 0, fieldConfidence, conflictingFields } as Prisma.InputJsonValue } }),
      ...documentFieldValueSyncOps(document, extraction),
      prisma.documentProcessingJob.update({ where: { id: job.id }, data: { status: "completed", completedAt: new Date(), leaseUntil: null } }),
      prisma.documentAuditEvent.create({ data: { workspaceId: document.workspaceId, documentId: document.id, type: "extraction_completed" } }),
    ])
  } catch (error) {
    const errorCode = safeErrorCode(error)
    const permanent = job.attempts >= 5 || PERMANENT_ERROR_CODES.includes(errorCode)
    const retryAt = new Date(Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, job.attempts - 1)))
    await prisma.$transaction([
      prisma.document.update({ where: { id: document.id }, data: { status: permanent ? "failed" : "queued", errorCode } }),
      prisma.documentProcessingJob.update({ where: { id: job.id }, data: { status: permanent ? "failed" : "queued", errorCode, scheduledAt: permanent ? job.scheduledAt : retryAt, completedAt: permanent ? new Date() : null, leaseUntil: null } }),
      prisma.documentAuditEvent.create({ data: { workspaceId: document.workspaceId, documentId: document.id, type: permanent ? "extraction_failed" : "extraction_retrying" } }),
    ])
    throw error
  }
}

export async function processNextQueuedDocumentJob() {
  const now = new Date()
  await prisma.documentProcessingJob.updateMany({ where: { status: "processing", leaseUntil: { lte: now } }, data: { status: "queued", leaseUntil: null, scheduledAt: now, errorCode: "processing_lease_expired" } })
  const job = await prisma.documentProcessingJob.findFirst({ where: { status: "queued", documentId: { not: null }, scheduledAt: { lte: now } }, orderBy: { scheduledAt: "asc" }, select: { id: true } })
  if (!job) return null
  await processDocumentJob(job.id)
  return job.id
}
