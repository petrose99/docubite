"use server"

// Only async functions may be exported from a "use server" module — a `const` export here
// typechecks and builds, then throws at runtime on the first request. Constants belong in
// lib/sheet-seed.ts, which this imports.
import { requestLLM } from "@/ai/providers/llmProvider"
import { ActionState } from "@/lib/actions"
import { aiFormulaHash, aiFormulaJsonSchema, assertAiFormulaCall, buildAiFormulaPrompt, isAiFormulaName, parseAiFormulaResult, type AiFormulaInput } from "@/lib/ai-formula"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { prisma } from "@/lib/db"
import type { FolderReport } from "@/components/extract/types"
import { findDuplicates, type DedupeDoc } from "@/lib/dedupe"
import { parseTemplateFields } from "@/lib/document-templates"
import { collectIssues, findPeriodGaps, groupDocuments, type ReportDoc } from "@/lib/gap-report"
import type { DocumentProvenance, Ref } from "@/lib/provenance"
import { diffExtractions, type RunDiff } from "@/lib/run-diff"
import { deriveSheet, type SheetColumn, type SheetRow } from "@/lib/sheet-derive"
import { cacheAiFormula, getCachedAiFormula } from "@/models/ai-formulas"
import { touchFile } from "@/models/files"
import { requireMember, NO_ACCESS } from "./action-helpers"

export type ExtractionRows = { sheetId: string; sheetName: string; columns: SheetColumn[]; rows: SheetRow[]; documentIds: string[] }

/** The rows a just-finished extraction should add to the live grid.
 *
 * The browser asks for these the moment a document reaches a terminal state, appends them
 * through the Univer facade, and then calls markDocumentsSheetAppliedAction. That is what makes
 * rows appear next to the Extract panel while it is still open, rather than on the next reload.
 *
 * Grouped by worksheet, because one upload batch can span several — the panel writes into the
 * worksheet that was selected, but a reconcile after a reload may span all of them. */
export async function getExtractionRowsAction(workspaceId: string, fileId: string, documentIds: string[]): Promise<ActionState<ExtractionRows[]>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }

  const documents = await prisma.document.findMany({
    where: { workspaceId, fileId, id: { in: documentIds.slice(0, 200) }, sheetAppliedAt: null, status: { notIn: ["received", "queued", "processing", "failed"] } },
    select: { id: true, filename: true, templateId: true, reviewedData: true, rawExtraction: true, confidence: true },
    orderBy: { receivedAt: "asc" },
  })
  if (!documents.length) return { success: true, data: [] }

  const templates = await prisma.documentTemplate.findMany({
    where: { fileId, id: { in: [...new Set(documents.map((document) => document.templateId).filter((id): id is string => !!id))] } },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  })

  const groups = templates.flatMap((template): ExtractionRows[] => {
    // A worksheet with no Univer tab yet has never been seeded; the next page load handles it.
    if (!template.univerSheetId) return []
    const forTemplate = documents.filter((document) => document.templateId === template.id)
    const fields = template.versions[0] ? parseTemplateFields(template.versions[0].fields) : []
    const { columns, rows } = deriveSheet(fields, forTemplate, { multiRow: template.multiRow })
    return rows.length ? [{ sheetId: template.univerSheetId, sheetName: template.name, columns, rows, documentIds: forTemplate.map((document) => document.id) }] : []
  })

  return { success: true, data: groups }
}

/** Marks documents as present in the grid, so no later reconcile appends them a second time.
 *
 * Called after the browser has written the rows, never before: a stamp written first and a
 * write that then failed would lose the rows permanently. Worst case here is a duplicate on
 * the next load, which is recoverable; the other order is not.
 *
 * Returns the workbook's current revision because the browser's is very likely stale by now. A
 * page render between the extraction finishing and this stamp reconciles the same rows on the
 * server and bumps the revision — so the tab that did the upload would find its next save
 * rejected and tell the user their sheet had been changed somewhere else, in the middle of the
 * flow they are watching. Once the documents are stamped no further server reconcile can touch
 * them, which makes this revision the settled one for the tab to carry on from. */
export async function markDocumentsSheetAppliedAction(workspaceId: string, fileId: string, documentIds: string[]): Promise<ActionState<{ marked: number; rev: number | null }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }

  const result = await prisma.document.updateMany({
    where: { workspaceId, fileId, id: { in: documentIds.slice(0, 200) }, sheetAppliedAt: null },
    data: { sheetAppliedAt: new Date() },
  })
  await touchFile(fileId)

  const workbook = await prisma.spreadsheetWorkbook.findUnique({ where: { fileId }, select: { rev: true } })
  return { success: true, data: { marked: result.count, rev: workbook?.rev ?? null } }
}

/** The name of the document a row was extracted from, for the source preview's title bar.
 *
 * The cells carry only the document id — a filename repeated across every cell of a 500-row
 * sheet would bloat the snapshot for something needed once, when someone opens the preview. */
export async function getDocumentSourceInfoAction(workspaceId: string, documentId: string): Promise<ActionState<{ filename: string; mimeType: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }

  const document = await prisma.document.findFirst({ where: { id: documentId, workspaceId }, select: { filename: true, mimeType: true, storageKey: true } })
  if (!document) return { success: false, error: "That document is no longer in this workspace" }
  if (!document.storageKey) return { success: false, error: "The original file for this row is no longer stored" }

  return { success: true, data: { filename: document.filename, mimeType: document.mimeType } }
}

type CellValue = string | number | boolean | null

/** A plain, viewer-friendly value for a cell — anything structured collapses to null rather than
 * rendering "[object Object]" in the preview header. */
function displayValue(value: unknown): CellValue {
  if (value === null || value === undefined) return null
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  return null
}

/** Where the value behind a cell was read from in its source document, resolved from the cell's
 * own `custom` pointer (documentId + fieldKey, plus itemIndex/itemKey for line-item cells).
 *
 * Because the query is that stable tuple rather than a grid position, the link survives any
 * reordering, sorting, or column move the sheet has been through since extraction. A null `ref`
 * is still success — the source opens, just without a highlight — as is a document that never
 * carried provenance. Authorised through the workspace, like the other sheet actions. */
export async function getCellProvenanceAction(
  workspaceId: string,
  documentId: string,
  fieldKey: string,
  itemIndex: number | null,
  itemKey: string | null,
): Promise<ActionState<{ filename: string; mimeType: string; ref: Ref | null; value: CellValue }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }

  const document = await prisma.document.findFirst({
    where: { id: documentId, workspaceId },
    select: { filename: true, mimeType: true, storageKey: true, provenance: true, reviewedData: true, rawExtraction: true },
  })
  if (!document) return { success: false, error: "That document is no longer in this workspace" }
  if (!document.storageKey) return { success: false, error: "The original file for this row is no longer stored" }

  const provenance = document.provenance as DocumentProvenance | null
  const data = ((document.reviewedData ?? document.rawExtraction) as Record<string, unknown> | null) ?? {}

  let ref: Ref | null = null
  let value: unknown = null
  if (itemKey) {
    // A line-item cell: the row's Ref lives at items[arrayFieldKey][itemIndex]; the value is the
    // sub-field inside that row.
    const rows = Array.isArray(data[fieldKey]) ? (data[fieldKey] as Record<string, unknown>[]) : []
    const row = itemIndex !== null ? rows[itemIndex] : undefined
    value = row ? row[itemKey] : null
    const refs = provenance?.items?.[fieldKey]
    ref = itemIndex !== null && Array.isArray(refs) ? refs[itemIndex] ?? null : null
  } else {
    value = data[fieldKey] ?? null
    ref = provenance?.fields?.[fieldKey] ?? null
  }

  return { success: true, data: { filename: document.filename, mimeType: document.mimeType, ref, value: displayValue(value) } }
}

/** How this document's extraction differs from the previous document of the same shape.
 *
 * "Previous" is the most recent settled document sharing this one's shape that arrived earlier —
 * so uploading this month's statement diffs it against last month's, catching a changed total or a
 * newly-missing field. Returns null (not an error) when the document has no shape or is the first
 * of its shape, which the caller shows as "nothing to compare against yet". Both sides read
 * reviewedData when a human has confirmed it, falling back to the raw extraction. */
export async function getShapeDiffAction(workspaceId: string, documentId: string): Promise<ActionState<{ shapeName: string; prevFilename: string; prevDocumentId: string; diff: RunDiff } | null>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }

  const document = await prisma.document.findFirst({
    where: { id: documentId, workspaceId },
    select: { id: true, shapeId: true, receivedAt: true, reviewedData: true, rawExtraction: true, fieldSnapshot: true, shape: { select: { name: true } } },
  })
  if (!document) return { success: false, error: "That document is no longer in this workspace" }
  if (!document.shapeId) return { success: true, data: null }

  const previous = await prisma.document.findFirst({
    where: { workspaceId, shapeId: document.shapeId, id: { not: documentId }, receivedAt: { lt: document.receivedAt }, status: { notIn: ["received", "queued", "processing", "failed"] } },
    orderBy: { receivedAt: "desc" },
    select: { id: true, filename: true, reviewedData: true, rawExtraction: true },
  })
  if (!previous) return { success: true, data: null }

  const fields = parseTemplateFields(document.fieldSnapshot)
  const nextData = ((document.reviewedData ?? document.rawExtraction) as Record<string, unknown> | null) ?? {}
  const prevData = ((previous.reviewedData ?? previous.rawExtraction) as Record<string, unknown> | null) ?? {}
  const diff = diffExtractions(fields, prevData, nextData)
  return { success: true, data: { shapeName: document.shape?.name ?? "document", prevFilename: previous.filename, prevDocumentId: previous.id, diff } }
}

const SETTLED_STATUSES = new Set(["ready_for_review", "needs_review", "reviewed", "failed"])

function readClassification(value: unknown): { docType: string; entity: string; period: string } {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const str = (key: string) => (typeof source[key] === "string" ? source[key] as string : "")
  return { docType: str("docType"), entity: str("entity"), period: str("period") }
}

/** Builds the deterministic folder report from an upload batch's documents — no LLM. Grouping,
 * dedupe, gaps, and issues all come out of code, so the report costs nothing to open and never
 * sends document text anywhere. */
async function buildFolderReport(workspaceId: string, fileId: string, uploadBatchId: string): Promise<FolderReport | null> {
  const documents = await prisma.document.findMany({
    where: { workspaceId, fileId, uploadBatchId },
    select: { id: true, filename: true, mimeType: true, sha256: true, ocrText: true, status: true, shapeId: true, classification: true, confidence: true },
    orderBy: { receivedAt: "asc" },
    take: 200,
  })
  if (!documents.length) return null

  const reportDocs: ReportDoc[] = documents.map((document) => {
    const classification = readClassification(document.classification)
    const confidence = document.confidence && typeof document.confidence === "object" ? document.confidence as { missingRequiredFields?: string[]; conflictingFields?: string[] } : null
    return { id: document.id, filename: document.filename, shapeId: document.shapeId, docType: classification.docType, entity: classification.entity, period: classification.period, status: document.status, confidence }
  })
  const dedupeDocs: DedupeDoc[] = documents.map((document) => ({ id: document.id, filename: document.filename, sha256: document.sha256, text: document.ocrText ?? "", period: readClassification(document.classification).period }))
  const byId = new Map(documents.map((document) => [document.id, document]))

  const groups = groupDocuments(reportDocs).map((group) => ({
    key: group.key,
    docType: group.docType,
    entity: group.entity,
    count: group.documentIds.length,
    documents: group.documentIds.map((id) => ({ id, filename: byId.get(id)?.filename ?? "", status: byId.get(id)?.status ?? "", mimeType: byId.get(id)?.mimeType ?? "" })),
    gaps: findPeriodGaps(group.periods),
  }))

  return {
    settled: documents.filter((document) => SETTLED_STATUSES.has(document.status)).length,
    total: documents.length,
    groups,
    duplicates: findDuplicates(dedupeDocs),
    issues: collectIssues(reportDocs),
    summary: null,
  }
}

/** The folder report for one upload batch: which kinds of document it holds, duplicates, missing
 * months, and per-document problems. Deterministic and free — the AI summary is a separate,
 * opt-in action. */
export async function getFolderReportAction(workspaceId: string, fileId: string, uploadBatchId: string): Promise<ActionState<FolderReport>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  const report = await buildFolderReport(workspaceId, fileId, uploadBatchId)
  if (!report) return { success: false, error: "No documents in this upload batch" }
  return { success: true, data: report }
}

/** One AI sentence over the report's *stats* — never the document text — generated only when the
 * user asks for it, so a folder can be processed and reviewed without spending an AI credit. */
export async function summarizeFolderReportAction(workspaceId: string, fileId: string, uploadBatchId: string): Promise<ActionState<{ summary: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { aiEnabled: true } })
  if (!workspace?.aiEnabled) return { success: false, error: "AI is turned off for this workspace" }
  const provider = config.ai.provider
  const apiKey = provider === "gemini" ? config.ai.geminiApiKey : config.ai.openaiApiKey
  const model = provider === "gemini" ? config.ai.geminiModelName : config.ai.openaiModelName
  if (!apiKey) return { success: false, error: "AI is not configured on this server" }

  const report = await buildFolderReport(workspaceId, fileId, uploadBatchId)
  if (!report) return { success: false, error: "No documents in this upload batch" }

  // Only the counts go to the model — group labels, counts, duplicate and gap counts, issues — so
  // no document content leaves the deterministic layer.
  const stats = {
    documents: report.total,
    groups: report.groups.map((group) => ({ type: group.docType || "unlabelled", entity: group.entity || undefined, count: group.count, missingMonths: group.gaps })),
    duplicatePairs: report.duplicates.length,
    issues: report.issues.map((issue) => issue.message),
  }
  const response = await requestLLM({ providers: [{ provider, apiKey, model }] }, {
    prompt: `These are the statistics of a batch of uploaded documents. Write two or three plain sentences summarising what the batch contains and what needs attention (missing months, duplicates, documents with problems). Do not invent anything beyond the statistics.\n\n${JSON.stringify(stats)}`,
    schema: { type: "object", properties: { summary: { type: "string", description: "Two or three sentences" } }, required: ["summary"] },
  })
  if (response.error) return { success: false, error: response.error }
  const summary = String(response.output?.summary ?? "").trim()
  if (!summary) return { success: false, error: "The model returned nothing" }
  return { success: true, data: { summary } }
}

/** Answers one `=AI("…", A2)` cell.
 *
 * The cache is the whole reason this is worth having. A formula recalculates whenever the sheet
 * is opened, a row above it changes, or Univer decides to; without memoising, a column of fifty
 * AI cells would spend fifty requests of the workspace's monthly allowance every single reload,
 * and the answers would drift each time for no reason the user could see. A cache hit costs
 * nothing and returns the same text the sheet showed yesterday.
 *
 * `cached` comes back so the grid can say which cells actually cost something. */
export async function evaluateAiFormulaAction(workspaceId: string, fn: string, prompt: string, inputs: AiFormulaInput[]): Promise<ActionState<{ result: string; cached: boolean }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  if (!isAiFormulaName(fn.toUpperCase())) return { success: false, error: `Unknown AI function ${fn}` }

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { aiEnabled: true } })
  if (!workspace?.aiEnabled) return { success: false, error: "AI is turned off for this workspace" }

  const provider = config.ai.provider
  const apiKey = provider === "gemini" ? config.ai.geminiApiKey : config.ai.openaiApiKey
  const model = provider === "gemini" ? config.ai.geminiModelName : config.ai.openaiModelName
  if (!apiKey) return { success: false, error: "AI is not configured on this server" }

  try {
    assertAiFormulaCall(prompt, inputs)
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Invalid AI formula" }
  }

  const hash = aiFormulaHash({ fn: fn.toUpperCase(), model, prompt, inputs })
  const cached = await getCachedAiFormula(workspaceId, hash)
  if (cached !== null) return { success: true, data: { result: cached, cached: true } }

  const response = await requestLLM({ providers: [{ provider, apiKey, model }] }, { prompt: buildAiFormulaPrompt(prompt, inputs), schema: aiFormulaJsonSchema })
  if (response.error) return { success: false, error: response.error }

  const result = parseAiFormulaResult(response.output)
  if (!result) return { success: false, error: "The model returned nothing" }

  // Best-effort: an answer the user can see beats failing the cell because the memo did not
  // store. It will simply cost again next time.
  await cacheAiFormula({ workspaceId, hash, result, model }).catch(() => null)
  return { success: true, data: { result, cached: false } }
}

/** Turns "total of every invoice from Acme" into a formula the user can look at before it goes
 * anywhere near a cell.
 *
 * Lido's AI formula builder, and the reason it is separate from the assistant is trust: the
 * assistant writes and asks forgiveness, while this hands back a formula and an explanation and
 * changes nothing until the user presses Insert. It is the right shape for the case where the
 * user knows what they want and only needs the syntax. */
export async function buildFormulaAction(workspaceId: string, request: string, context: { headers: string[]; sampleRow: (string | number | boolean | null)[]; targetRef: string }): Promise<ActionState<{ formula: string; explanation: string }>> {
  const user = await getCurrentUser()
  if (!(await requireMember(workspaceId, user.id))) return { success: false, error: NO_ACCESS }
  if (!request.trim()) return { success: false, error: "Describe what the formula should do" }

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { aiEnabled: true } })
  if (!workspace?.aiEnabled) return { success: false, error: "AI is turned off for this workspace" }

  const provider = config.ai.provider
  const apiKey = provider === "gemini" ? config.ai.geminiApiKey : config.ai.openaiApiKey
  const model = provider === "gemini" ? config.ai.geminiModelName : config.ai.openaiModelName
  if (!apiKey) return { success: false, error: "AI is not configured on this server" }

  const columns = context.headers
    .map((header, index) => `${String.fromCharCode(65 + index)}: ${header || "(no header)"}${context.sampleRow[index] === undefined || context.sampleRow[index] === null ? "" : ` — e.g. ${context.sampleRow[index]}`}`)
    .join("\n")

  const response = await requestLLM({ providers: [{ provider, apiKey, model }] }, {
    prompt: `Write one spreadsheet formula for the cell ${context.targetRef}.

The sheet's columns, with a sample value from the first data row (row 1 is the header, row 2 is the first data row):
${columns}

What the user wants: ${request.slice(0, 1000)}

Rules: reply with a single formula beginning with "=", using standard Excel functions and A1 references. Do not wrap it in code fences. Explain it in one short sentence.`,
    schema: {
      type: "object",
      properties: {
        formula: { type: "string", description: 'The formula, starting with "="' },
        explanation: { type: "string", description: "One sentence on what it does" },
      },
      required: ["formula", "explanation"],
    },
  })
  if (response.error) return { success: false, error: response.error }

  // Models fence formulas and drop the leading "=" about as often as they get it right.
  const raw = String(response.output?.formula ?? "").replace(/```[a-z]*|```/g, "").trim()
  const formula = raw && !raw.startsWith("=") ? `=${raw}` : raw
  if (!formula) return { success: false, error: "The model did not return a formula" }

  return { success: true, data: { formula, explanation: String(response.output?.explanation ?? "").trim() } }
}
