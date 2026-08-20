import { requestLLM } from "@/ai/providers/llmProvider"
import { getAsrBackend } from "@/lib/asr"
import type { AsrResult } from "@/lib/asr/types"
import config from "@/lib/config"
import { prisma } from "@/lib/db"
import { biasTermsForTemplate } from "@/lib/domains"
import {
  buildDocumentJsonSchema, extractClassification, extractFieldConfidence, extractFieldProvenance,
  findMissingRequiredFields, parseTemplateFields, validateDocumentValues, type DocumentFieldDefinition,
} from "@/lib/document-templates"
import { readDocumentSource } from "@/lib/document-storage"
import { projectDocumentFields } from "@/lib/field-projection"
import {
  buildFieldSuggestionInstructions, type FieldSuggestionMode, parseSuggestedTitle, parseSuggestedTranscriptFields,
  suggestedFieldsSchemaProperty, suggestedTitleSchemaProperty,
} from "@/lib/field-suggestions"
import { buildAudioProvenance } from "@/lib/provenance-audio"
import { replaceDocumentFieldValues } from "@/models/document-field-values"
import { createFieldSuggestions } from "@/models/field-suggestions"
import { consumeWorkspaceQuota } from "@/models/workspaces"
// Type-only: a runtime import of Prisma in a module reachable from a test breaks vitest's
// resolution of @/prisma/client. Only the InputJsonValue type is needed here.
import type { Prisma } from "@/prisma/client"

/** The transcribe job: audio in, the same Document shape out.
 *
 * A dictation deliberately reuses the extract job's entire downstream: the transcript lands in
 * `ocrText`, so chunking, embedding and hybrid retrieval index it with no new retrieval code; the
 * structured values go through the same validation, projection and confidence machinery. The only
 * things that differ are how the text is obtained (ASR rather than MinerU) and what provenance
 * points at (a time span rather than a page rectangle). */

const OCR_TEXT_LIMIT = 100_000

/** Errors that will fail identically on every retry. Merged into the extract path's list by
 * document-processing, so a permanently broken dictation fails fast instead of burning attempts. */
export const PERMANENT_ASR_ERROR_CODES = [
  "asr_not_configured",
  "asr_bad_request",
  "asr_auth_failed",
  "asr_audio_empty",
  "asr_audio_too_large",
  "document_source_missing",
]

/** Restructure, never infer.
 *
 * The task given to the model is deliberately "slot these statements into these fields", not
 * "write up this case". Feeding it the domain schema is what makes that framing possible: with the
 * target fields named and described, filling them is a sorting task with a right answer, rather
 * than a generative one where a plausible-sounding value would pass unnoticed. */
export function buildTranscriptPrompt(templateName: string, fields: DocumentFieldDefinition[], transcript: string, biasTerms: string[], customPrompt?: string | null): string {
  const mode: FieldSuggestionMode = fields.length === 0 ? "discover" : "supplement"
  return [
    mode === "discover"
      ? `The text below is an automatic transcript of a spoken ${templateName}. There is no predefined field list — read what was actually said and propose the fields below.`
      : `The text below is an automatic transcript of a spoken ${templateName}. Sort what was SAID into the fields below.`,
    "",
    "Rules:",
    "- Extract only values the speaker actually stated. Never infer, complete, or normalise a value that was not spoken.",
    ...(mode === "supplement" ? ["- A field the speaker did not mention is omitted entirely. Do not guess it from the other fields."] : []),
    "- Where the transcript is garbled or a word is uncertain, extract the most plausible reading ONLY if it is unambiguous; otherwise use the literal text [unclear].",
    "- Speech has false starts, corrections and filler. Where the speaker corrected themselves, take the CORRECTED value.",
    "- Spoken numbers and dates become digits (\"the fourteenth of March twenty twenty-six\" -> 2026-03-14). Dates use YYYY-MM-DD.",
    "- Spelled-out identifiers (\"S dash twenty-six dash one two three four\") become their written form.",
    ...(biasTerms.length ? [
      "",
      "Domain vocabulary the speech-to-text step may have mangled. Correct an obvious phonetic mangling of one",
      "of these, but never substitute one for a word that was clearly something else:",
      biasTerms.join(", "),
    ] : []),
    ...(mode === "supplement" ? [
      "",
      "Also return `_confidence` (0-1 per top-level field, reflecting BOTH how clearly it was spoken and how certain the mapping is),",
      "and `_provenance`: for each field, a short verbatim quote (under 120 characters) of the transcript around where it was said.",
      "Page numbers do not apply to audio; omit `page`.",
    ] : []),
    "Also return `_classification`: doc_type, entity, period.",
    buildFieldSuggestionInstructions(mode),
    customPrompt?.trim() ? `\nWorkspace instructions:\n${customPrompt.trim()}` : "",
    "",
    "Transcript:",
    transcript,
  ].filter(Boolean).join("\n")
}

/** Fields the model reported that the recording does not actually support.
 *
 * A dictated value is only as good as the audio behind it. Two independent signals say a value has
 * no audio behind it: the model gave it NO confidence score, and the provenance resolver could not
 * tie it to any spoken segment. Either alone is weak — a normalised numeral ("2" for spoken "two")
 * routinely fails to pin — but together they mean nothing in the recording backs the value.
 *
 * Observed case: "Let's make a specimen." yielded `total: 0`, with no score and no pin. A zero
 * total is legitimate on a credit note, so it cannot be dropped on its value; it CAN be flagged on
 * its lack of support.
 *
 * Flagged, deliberately, rather than discarded: dropping would also silently bin real values that
 * merely failed to pin, and a visible wrong number is safer than an invisible missing one. */
export function findUnsupportedFields(
  fields: DocumentFieldDefinition[],
  values: Record<string, unknown>,
  confidence: Record<string, number>,
  provenance: { fields: Record<string, unknown>; items: Record<string, unknown> },
): string[] {
  return fields
    .filter((field) => {
      const value = values[field.key]
      if (value === undefined || value === null || value === "") return false
      if (typeof confidence[field.key] === "number") return false
      return field.type === "array" ? !provenance.items[field.key] : !provenance.fields[field.key]
    })
    .map((field) => field.key)
}

type TranscribeJobDocument = {
  id: string
  workspaceId: string
  fileId: string
  templateId: string | null
  mimeType: string
  storageKey: string | null
  fieldSnapshot: Prisma.JsonValue
  aiQuotaClaimed: boolean
  workspace: { aiEnabled: boolean }
  template: { name: string; code: string } | null
  templateVersion: { prompt: string | null } | null
}

/** Transcribes the audio and stores the transcript. Split from the structuring step below so the
 * transcript is persisted even if the LLM step then fails — the same principle as the extract job
 * writing ocrText before extraction: indexing must depend only on the text, never on the
 * structuring succeeding. */
export async function transcribeDocumentAudio(document: TranscribeJobDocument): Promise<AsrResult> {
  if (!config.asr.enabled) throw new Error("asr_not_configured")
  if (!document.storageKey) throw new Error("document_source_missing")
  const audio = await readDocumentSource(document.storageKey)
  const backend = getAsrBackend()
  const biasTerms = biasTermsForTemplate(document.template?.code)
  // The language hint is passed explicitly. Leaving the model to auto-detect is what produced a
  // 4-second English clip transcribed as fluent Icelandic — on short or quiet audio, detection is
  // a coin flip and a wrong call poisons the whole transcript.
  const result = await backend.transcribe(audio, { mimeType: document.mimeType, biasTerms, language: config.asr.language })

  await prisma.document.update({
    where: { id: document.id },
    data: {
      ocrText: result.text.slice(0, OCR_TEXT_LIMIT),
      transcript: result.segments as unknown as Prisma.InputJsonValue,
      transcriptModel: result.model,
    },
  })
  return result
}

/** Structures a stored transcript into the worksheet's fields, with audio provenance. */
export async function structureTranscript(document: TranscribeJobDocument, transcript: AsrResult) {
  const fields = parseTemplateFields(document.fieldSnapshot)
  const apiKey = config.ai.provider === "gemini" ? config.ai.geminiApiKey : config.ai.openaiApiKey
  const model = config.ai.provider === "gemini" ? config.ai.geminiModelName : config.ai.openaiModelName
  if (!apiKey) throw new Error("platform_ai_not_configured")

  const mode: FieldSuggestionMode = fields.length === 0 ? "discover" : "supplement"
  const biasTerms = biasTermsForTemplate(document.template?.code)
  const schema = buildDocumentJsonSchema(fields)
  const response = await requestLLM(
    { providers: [{ provider: config.ai.provider, apiKey, model }] },
    {
      prompt: buildTranscriptPrompt(document.template?.name || "document", fields, transcript.text, biasTerms, document.templateVersion?.prompt),
      // additionalProperties: false on the base schema means the suggestion property must be
      // spliced in here rather than appended by the caller after the fact.
      schema: {
        ...schema,
        properties: {
          ...schema.properties,
          _suggested_fields: suggestedFieldsSchemaProperty(),
          ...(mode === "discover" ? { _suggested_title: suggestedTitleSchemaProperty() } : {}),
        },
      },
    },
  )
  if (response.error) throw new Error("ai_structuring_failed")

  const values = validateDocumentValues(fields, response.output)
  const fieldConfidence = extractFieldConfidence(fields, response.output)
  const hints = extractFieldProvenance(fields, response.output)
  const classification = extractClassification(response.output)
  const provenance = buildAudioProvenance(fields, hints, values, transcript.segments)
  const missing = findMissingRequiredFields(fields, values)
  const unsupportedFields = findUnsupportedFields(fields, values, fieldConfidence, provenance)
  const suggestions = parseSuggestedTranscriptFields(response.output, new Set(fields.map((field) => field.key)), mode)
  const suggestedTitle = mode === "discover" ? parseSuggestedTitle(response.output) : null

  // source "asr": every value here originated in speech, which is a materially different
  // reliability story from OCR'd print and is surfaced as such next to the value. The audio
  // provenance rides along too, so a value found by a structured filter can still be cited to the
  // moment it was spoken — the audio equivalent of citing a page and rectangle.
  const rows = projectDocumentFields({ fields, values, confidence: fieldConfidence, provenance, source: "asr" })

  // With no fields at all, `missing` is trivially empty — but the entire content of the dictation
  // is sitting unapproved in `suggestions`, not in any field. Landing that as "ready_for_review"
  // would look done when nothing has actually been reviewed yet.
  const needsReview = missing.length > 0 || (fields.length === 0 && suggestions.length > 0)

  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: { id: document.id },
      data: {
        status: needsReview ? "needs_review" : "ready_for_review",
        rawExtraction: values as Prisma.InputJsonValue,
        reviewedData: values as Prisma.InputJsonValue,
        provenance: provenance as unknown as Prisma.InputJsonValue,
        classification: classification as unknown as Prisma.InputJsonValue,
        confidence: { missingRequiredFields: missing, fieldConfidence, unsupportedFields, source: "asr" } as Prisma.InputJsonValue,
        ...(suggestedTitle ? { suggestedTitle } : {}),
      },
    })
    await replaceDocumentFieldValues({ workspaceId: document.workspaceId, documentId: document.id, fileId: document.fileId, templateCode: document.template?.code ?? null, rows }, tx)
    // Re-running structuring (a transcript edit) replaces this pass's proposals with a fresh set,
    // since a corrected transcript can change what has no home in the schema. An already-approved
    // suggestion is untouched — it is no longer "pending" — and its key will not be re-proposed
    // anyway (see the existingKeys filter in structureTranscript above, once the field is real).
    await tx.fieldSuggestion.deleteMany({ where: { documentId: document.id, status: "pending" } })
    if (suggestions.length) {
      await createFieldSuggestions({ workspaceId: document.workspaceId, documentId: document.id, templateId: document.templateId, suggestions }, tx)
    }
  }, { timeout: 20_000 })

  return { values, missing }
}

/** The document fields structuring needs. Selected rather than loaded whole because ocrText can be
 * 100k characters and none of the callers below need the rest of the row. */
const TRANSCRIBE_JOB_SELECT = {
  id: true, workspaceId: true, fileId: true, templateId: true, mimeType: true, storageKey: true, fieldSnapshot: true,
  aiQuotaClaimed: true, ocrText: true, transcript: true,
  workspace: { select: { aiEnabled: true } },
  template: { select: { name: true, code: true } },
  templateVersion: { select: { prompt: true } },
} as const

/** Re-runs structuring against a transcript a person has corrected.
 *
 * The audio is not touched and not re-transcribed — the recording is unchanged, only our reading of
 * it is. The stored segments are reused as-is for provenance, which means an edited phrase no longer
 * matches any segment and `resolveAudioRef` scores it below ACCEPT_SCORE, so that field comes back
 * with no audio pin. That is the correct answer rather than a shortcoming: an edited sentence
 * genuinely has no moment in the recording where it was said, and a pin to the nearest thing that
 * *was* said would be a false citation. The verify screen shows the absent pin.
 *
 * Deliberately not a queued job. It is one LLM call on text already in hand, and the person who
 * made the correction is sitting in front of the result waiting to see whether it took. */
export async function restructureFromTranscript(workspaceId: string, documentId: string) {
  const document = await prisma.document.findFirst({ where: { id: documentId, workspaceId }, select: TRANSCRIBE_JOB_SELECT })
  if (!document) throw new Error("document_not_found")
  if (!document.ocrText.trim()) throw new Error("transcript_empty")

  const segments = Array.isArray(document.transcript) ? (document.transcript as unknown as AsrResult["segments"]) : []
  return structureTranscript(document, { text: document.ocrText, segments, language: config.asr.language, model: "edited" })
}

/** The transcribe job handler, mirroring processDocumentJob's contract: it owns claiming through to
 * completion for its own job row, and quota is consumed exactly once per document. */
export async function processTranscribeJob(job: { id: string; attempts: number; scheduledAt: Date; document: TranscribeJobDocument }) {
  const document = job.document
  if (!document.workspace.aiEnabled) {
    await prisma.$transaction([
      prisma.document.update({ where: { id: document.id }, data: { status: "ready_for_review", reviewedData: {}, confidence: { aiEnabled: false } } }),
      prisma.documentProcessingJob.update({ where: { id: job.id }, data: { status: "completed", completedAt: new Date(), leaseUntil: null } }),
    ])
    return
  }
  if (!document.aiQuotaClaimed) {
    await consumeWorkspaceQuota(document.workspaceId, "ai")
    await prisma.document.update({ where: { id: document.id }, data: { aiQuotaClaimed: true } })
  }
  const transcript = await transcribeDocumentAudio(document)
  await structureTranscript(document, transcript)
  await prisma.$transaction([
    prisma.documentProcessingJob.update({ where: { id: job.id }, data: { status: "completed", completedAt: new Date(), leaseUntil: null } }),
    prisma.documentAuditEvent.create({ data: { workspaceId: document.workspaceId, documentId: document.id, type: "extraction_completed" } }),
  ])
}
