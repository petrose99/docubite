import type { ParsedFieldSuggestion } from "@/lib/field-suggestions"
import { prisma } from "@/lib/db"
import type { AsrSegment } from "@/lib/asr/types"
import { documentFieldSchema, documentTemplateFieldsSchema, findMissingRequiredFields, parseTemplateFields, validateDocumentValues } from "@/lib/document-templates"
import { projectDocumentFields } from "@/lib/field-projection"
import { resolveAudioRef, type AudioProvenance } from "@/lib/provenance-audio"
import { replaceDocumentFieldValues } from "@/models/document-field-values"
import type { Prisma } from "@/prisma/client"

/** Persists the transcript pass's proposals as pending rows.
 *
 * Insert, not upsert: a duplicate key within one document is already impossible by the time this
 * runs — parseSuggestedTranscriptFields dedupes within a pass, and structureTranscript clears the
 * document's prior pending rows before calling this — so a unique-constraint hit here means a race
 * with a second transcription of the same document, which is a real conflict worth surfacing
 * rather than silently overwriting. */
export async function createFieldSuggestions(
  input: { workspaceId: string; documentId: string; templateId: string | null; suggestions: ParsedFieldSuggestion[] },
  tx: Prisma.TransactionClient = prisma,
) {
  await tx.fieldSuggestion.createMany({
    data: input.suggestions.map((suggestion) => ({
      workspaceId: input.workspaceId,
      documentId: input.documentId,
      templateId: input.templateId,
      key: suggestion.key,
      label: suggestion.label,
      type: suggestion.type,
      instruction: suggestion.instruction,
      value: suggestion.value,
      quote: suggestion.quote,
      confidence: suggestion.confidence,
    })),
  })
}

export function listPendingFieldSuggestions(workspaceId: string, documentId: string) {
  return prisma.fieldSuggestion.findMany({
    where: { workspaceId, documentId, status: "pending" },
    orderBy: { createdAt: "asc" },
  })
}

/** Marks a proposal dismissed without touching the template or the document. The suggestion stays
 * in place (never deleted) so "we looked at this and said no" is as visible in the audit trail as
 * an approval — a silently vanished proposal would look identical to one nobody ever reviewed. */
export async function dismissFieldSuggestion(input: { workspaceId: string; documentId: string; suggestionId: string; actorId: string }) {
  const suggestion = await prisma.fieldSuggestion.findFirst({ where: { id: input.suggestionId, workspaceId: input.workspaceId, documentId: input.documentId, status: "pending" } })
  if (!suggestion) throw new Error("suggestion_not_found")
  await prisma.fieldSuggestion.update({
    where: { id: suggestion.id },
    data: { status: "dismissed", decidedAt: new Date(), decidedById: input.actorId },
  })
}

/** Approves a proposal: appends the field to the template (a new DocumentTemplateVersion, exactly
 * how updateDocumentTemplateAction grows a template by hand) and backfills the value onto the
 * document the proposal came from. Every OTHER document stays pinned to its old template snapshot
 * — the same rule any template edit follows — this document is re-pinned to the new one because
 * backfilling ITS value is the entire point of accepting.
 *
 * If the key was independently added to the template between proposal and approval (a second
 * suggestion approved first, or a person editing the template by hand), no new version is created;
 * the value is written onto the field that already exists rather than fighting over who owns it. */
export async function acceptFieldSuggestion(input: { workspaceId: string; documentId: string; suggestionId: string; actorId: string }) {
  const suggestion = await prisma.fieldSuggestion.findFirst({ where: { id: input.suggestionId, workspaceId: input.workspaceId, documentId: input.documentId, status: "pending" } })
  if (!suggestion) throw new Error("suggestion_not_found")

  const document = await prisma.document.findFirst({
    where: { id: input.documentId, workspaceId: input.workspaceId },
    include: { template: true, templateVersion: true },
  })
  if (!document) throw new Error("document_not_found")

  const currentFields = parseTemplateFields(document.fieldSnapshot)
  const alreadyExists = currentFields.some((field) => field.key === suggestion.key)

  let fieldSnapshot = document.fieldSnapshot
  let templateVersionId = document.templateVersionId

  if (!alreadyExists) {
    const definition = documentFieldSchema.parse({
      key: suggestion.key, label: suggestion.label, type: suggestion.type, instruction: suggestion.instruction, required: false,
    })
    const nextFields = documentTemplateFieldsSchema.parse([...currentFields, definition])

    if (document.template) {
      const created = await prisma.$transaction([
        prisma.documentTemplate.update({ where: { id: document.template.id }, data: { currentVersion: { increment: 1 } } }),
        prisma.documentTemplateVersion.create({
          data: {
            templateId: document.template.id,
            version: document.template.currentVersion + 1,
            fields: nextFields as unknown as Prisma.InputJsonValue,
            prompt: document.templateVersion?.prompt ?? null,
          },
        }),
      ])
      templateVersionId = created[1].id
    }
    fieldSnapshot = nextFields as unknown as Prisma.JsonValue
  }

  const fields = parseTemplateFields(fieldSnapshot)
  const priorValues = (document.reviewedData as Record<string, unknown> | null) ?? (document.rawExtraction as Record<string, unknown> | null) ?? {}
  const candidate = { ...priorValues, [suggestion.key]: suggestion.type === "number" ? Number(suggestion.value) : suggestion.type === "boolean" ? suggestion.value === "true" : suggestion.value }
  const reviewedData = validateDocumentValues(fields, candidate)
  const missing = findMissingRequiredFields(fields, reviewedData)

  const priorConfidence = (document.confidence as Record<string, unknown> | null) ?? {}
  const priorFieldConfidence = (priorConfidence.fieldConfidence as Record<string, number> | null) ?? {}
  const nextFieldConfidence = suggestion.confidence === null ? priorFieldConfidence : { ...priorFieldConfidence, [suggestion.key]: suggestion.confidence }

  const segments = (Array.isArray(document.transcript) ? document.transcript : []) as unknown as AsrSegment[]
  const ref = resolveAudioRef(suggestion.quote, segments) ?? resolveAudioRef(suggestion.value, segments)
  const priorProvenance = (document.provenance as unknown as AudioProvenance | null) ?? { version: 1 as const, fields: {}, items: {} }
  const nextProvenance: AudioProvenance = { ...priorProvenance, fields: ref ? { ...priorProvenance.fields, [suggestion.key]: ref } : priorProvenance.fields }

  const rows = projectDocumentFields({ fields, values: reviewedData, confidence: nextFieldConfidence, provenance: nextProvenance, source: "asr" })

  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: document.id },
      data: {
        fieldSnapshot: fieldSnapshot as Prisma.InputJsonValue,
        templateVersionId,
        reviewedData: reviewedData as Prisma.InputJsonValue,
        provenance: nextProvenance as unknown as Prisma.InputJsonValue,
        confidence: { ...priorConfidence, missingRequiredFields: missing, fieldConfidence: nextFieldConfidence } as Prisma.InputJsonValue,
      },
    })
    await tx.fieldSuggestion.update({ where: { id: suggestion.id }, data: { status: "approved", decidedAt: new Date(), decidedById: input.actorId } })
    await tx.documentAuditEvent.create({ data: { workspaceId: input.workspaceId, documentId: document.id, actorId: input.actorId, type: "field_suggestion_approved" } })
    await replaceDocumentFieldValues({ workspaceId: input.workspaceId, documentId: document.id, fileId: document.fileId, templateCode: document.template?.code ?? null, rows }, tx)
  }, { timeout: 20_000 })
}
