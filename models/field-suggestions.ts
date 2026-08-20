import type { ParsedFieldSuggestion } from "@/lib/field-suggestions"
import { prisma } from "@/lib/db"
import type { AsrSegment } from "@/lib/asr/types"
import { documentFieldSchema, documentTemplateFieldsSchema, findMissingRequiredFields, parseTemplateFields, validateDocumentValues, type DocumentFieldDefinition } from "@/lib/document-templates"
import { findDomainAdapter } from "@/lib/domains"
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

/** "Dismiss all" — the same operation as dismissFieldSuggestion, applied to every pending
 * suggestion on the document. Silently skips anything already decided rather than erroring, since
 * the button means "clear what's left", not "these exact rows must still be pending". */
export async function dismissFieldSuggestions(input: { workspaceId: string; documentId: string; actorId: string }) {
  await prisma.fieldSuggestion.updateMany({
    where: { workspaceId: input.workspaceId, documentId: input.documentId, status: "pending" },
    data: { status: "dismissed", decidedAt: new Date(), decidedById: input.actorId },
  })
}

/** Approves one or more proposals in a single pass: appends the accepted fields to the template
 * (one new DocumentTemplateVersion for the whole batch — not one per field, which would leave a
 * 20-field discover-mode dictation with 20 template versions) and backfills every value onto the
 * document the proposals came from. Every OTHER document stays pinned to its old template snapshot,
 * the same rule any template edit follows; this document is re-pinned because backfilling its
 * values is the entire point of accepting.
 *
 * `items` carries the person's edits (label/type/value) made on the verify screen before accepting
 * — the suggestion row itself is never mutated, so a dismissed-then-reconsidered edit can't corrupt
 * what the model actually proposed.
 *
 * Ephemeral domains (lib/domains: blank/general_report) never touch the shared template at all —
 * accepted fields land only in this document's own fieldSnapshot. Every dictation under an
 * ephemeral pack discovers its own fields from a blank slate; sharing them via a template version
 * would mean dictation #2 inherits dictation #1's unrelated fields. */
export async function acceptFieldSuggestions(input: {
  workspaceId: string
  documentId: string
  actorId: string
  items: { suggestionId: string; label?: string; type?: DocumentFieldDefinition["type"]; value?: string }[]
}) {
  if (!input.items.length) return

  const suggestionIds = input.items.map((item) => item.suggestionId)
  const suggestions = await prisma.fieldSuggestion.findMany({
    where: { id: { in: suggestionIds }, workspaceId: input.workspaceId, documentId: input.documentId, status: "pending" },
  })
  if (!suggestions.length) throw new Error("suggestion_not_found")
  const suggestionById = new Map(suggestions.map((suggestion) => [suggestion.id, suggestion]))

  const document = await prisma.document.findFirst({
    where: { id: input.documentId, workspaceId: input.workspaceId },
    include: { template: true, templateVersion: true },
  })
  if (!document) throw new Error("document_not_found")
  const ephemeral = findDomainAdapter(document.template?.code)?.ephemeral ?? false

  const currentFields = parseTemplateFields(document.fieldSnapshot)
  const existingKeys = new Set(currentFields.map((field) => field.key))
  const accepted: { suggestion: (typeof suggestions)[number]; label: string; type: DocumentFieldDefinition["type"]; value: string }[] = []
  const newDefinitions: DocumentFieldDefinition[] = []

  for (const item of input.items) {
    const suggestion = suggestionById.get(item.suggestionId)
    if (!suggestion) continue
    const label = item.label?.trim() || suggestion.label
    const type = item.type ?? (suggestion.type as DocumentFieldDefinition["type"])
    const value = item.value?.trim() || suggestion.value
    accepted.push({ suggestion, label, type, value })
    if (!existingKeys.has(suggestion.key)) {
      newDefinitions.push(documentFieldSchema.parse({ key: suggestion.key, label, type, instruction: suggestion.instruction, required: false }))
      existingKeys.add(suggestion.key)
    }
  }
  if (!accepted.length) return

  let fieldSnapshot = document.fieldSnapshot
  let templateVersionId = document.templateVersionId

  if (newDefinitions.length) {
    const nextFields = documentTemplateFieldsSchema.parse([...currentFields, ...newDefinitions])

    if (document.template && !ephemeral) {
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
    // Ephemeral: no template version is minted at all — the field only ever exists in this
    // document's own fieldSnapshot, so templateVersionId is left pointing at whatever it pointed
    // at before (the blank template's one version, which never grows).
    fieldSnapshot = nextFields as unknown as Prisma.JsonValue
  }

  const fields = parseTemplateFields(fieldSnapshot)
  const priorValues = (document.reviewedData as Record<string, unknown> | null) ?? (document.rawExtraction as Record<string, unknown> | null) ?? {}
  const candidate = { ...priorValues }
  for (const { suggestion, type, value } of accepted) {
    candidate[suggestion.key] = type === "number" ? Number(value) : type === "boolean" ? value === "true" : value
  }
  const reviewedData = validateDocumentValues(fields, candidate)
  const missing = findMissingRequiredFields(fields, reviewedData)

  const priorConfidence = (document.confidence as Record<string, unknown> | null) ?? {}
  const priorFieldConfidence = (priorConfidence.fieldConfidence as Record<string, number> | null) ?? {}
  const nextFieldConfidence = { ...priorFieldConfidence }

  const segments = (Array.isArray(document.transcript) ? document.transcript : []) as unknown as AsrSegment[]
  const priorProvenance = (document.provenance as unknown as AudioProvenance | null) ?? { version: 1 as const, fields: {}, items: {} }
  const nextProvenanceFields = { ...priorProvenance.fields }

  for (const { suggestion } of accepted) {
    if (suggestion.confidence !== null) nextFieldConfidence[suggestion.key] = suggestion.confidence
    // Audio provenance is resolved individually per field, exactly as a single accept does — a
    // batch of edits is still, one at a time, "where in the recording was this actually said".
    const ref = resolveAudioRef(suggestion.quote, segments) ?? resolveAudioRef(suggestion.value, segments)
    if (ref) nextProvenanceFields[suggestion.key] = ref
  }
  const nextProvenance: AudioProvenance = { ...priorProvenance, fields: nextProvenanceFields }

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
        // With no fields pending review left over, a batch accept can be the thing that finally
        // makes this dictation reviewed — mirrors the needsReview logic in structureTranscript.
        status: missing.length ? "needs_review" : "ready_for_review",
      },
    })
    await tx.fieldSuggestion.updateMany({
      where: { id: { in: accepted.map(({ suggestion }) => suggestion.id) } },
      data: { status: "approved", decidedAt: new Date(), decidedById: input.actorId },
    })
    await tx.documentAuditEvent.create({ data: { workspaceId: input.workspaceId, documentId: document.id, actorId: input.actorId, type: "field_suggestion_approved" } })
    await replaceDocumentFieldValues({ workspaceId: input.workspaceId, documentId: document.id, fileId: document.fileId, templateCode: document.template?.code ?? null, rows }, tx)
  }, { timeout: 20_000 })
}

/** One-suggestion wrapper around acceptFieldSuggestions, for the single Accept button. */
export async function acceptFieldSuggestion(input: { workspaceId: string; documentId: string; suggestionId: string; actorId: string }) {
  await acceptFieldSuggestions({ workspaceId: input.workspaceId, documentId: input.documentId, actorId: input.actorId, items: [{ suggestionId: input.suggestionId }] })
}
