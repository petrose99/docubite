import { documentFieldSchema, type DocumentFieldDefinition } from "@/lib/document-templates"

/** Dynamic field naming for dictation.
 *
 * The transcript-structuring prompt (lib/document-transcription.ts) is deliberately "restructure,
 * never infer": the model sorts what was said into fields it is handed, so a value cannot be
 * silently invented. That guarantee is about VALUES. It says nothing about the case where the
 * speaker clearly stated a fact the current template has no field for at all — a marker, a
 * measurement, a finding the template's author did not anticipate. Today that content is simply
 * lost: it exists in the transcript but nowhere in the structured fields, the sheet, or the report.
 *
 * This is the other half: alongside the normal restructuring pass, the model may also propose new
 * fields for content it could not place. A proposal is not a write — nothing about the template or
 * the document changes until a person approves it (models/field-suggestions.ts). The field
 * definition, value and quote are all captured now, at proposal time, because the model has
 * already read the transcript once; re-reading it later to fill the field in risks a second pass
 * disagreeing with the first about what was actually said. */

const SUGGESTABLE_TYPES = new Set(["string", "number", "date", "boolean"])
/** Caps how many proposals one dictation can generate. A transcript with a dozen genuinely novel
 * facts is the exception; a cap turns "the model went generative" into an honest small mistake
 * rather than a wall of noise a reviewer has to triage. */
const MAX_SUGGESTIONS = 6

export type ParsedFieldSuggestion = {
  key: string
  label: string
  type: DocumentFieldDefinition["type"]
  instruction: string
  value: string
  quote: string
  confidence: number | null
}

/** Appended to buildTranscriptPrompt's instructions. Framed as a last resort ("only if... cannot
 * be placed") rather than an invitation, because the model defaults to restructuring and this must
 * stay the exception — a schema that grows by one field per dictation is not dynamic, it is
 * unusable. */
export function buildFieldSuggestionInstructions(): string {
  return [
    "",
    "Also return `_suggested_fields`: an array for content the speaker CLEARLY and FACTUALLY stated",
    "that cannot be placed in ANY field above — not filler, not something a listed field already",
    "covers even loosely. Leave this empty unless something genuinely has nowhere to go.",
    "For each: key (snake_case), label (short Title Case), type (string, number, date, or boolean),",
    "instruction (one sentence a future extractor could follow), value (what was said, in the same",
    "normalised form as any other field value), quote (a short verbatim quote from the transcript),",
    "and confidence (0-1, exactly like the top-level `_confidence` scores).",
  ].join("\n")
}

/** The `_suggested_fields` JSON Schema property, appended to buildDocumentJsonSchema's output for
 * the transcribe path only — regular document extraction does not get this, because "restructure,
 * never infer" is the correctness property that matters most where OCR'd numbers feed a ledger. */
export function suggestedFieldsSchemaProperty() {
  return {
    type: "array",
    description: "Fields with no home in the schema above, for content the speaker clearly stated",
    items: {
      type: "object",
      properties: {
        key: { type: "string", description: "snake_case key, not already used above" },
        label: { type: "string", description: "Short Title Case field name" },
        type: { type: "string", enum: ["string", "number", "date", "boolean"], description: "Value type" },
        instruction: { type: "string", description: "One sentence describing what this field captures" },
        value: { type: "string", description: "The value as stated, normalised like any other field" },
        quote: { type: "string", description: "Short verbatim quote (under 120 chars) from the transcript" },
        confidence: { type: "number", description: "Confidence from 0 to 1 that this is a real, distinct field" },
      },
      required: ["key", "label", "type", "value"],
      additionalProperties: false,
    },
  } as const
}

const coerceKey = (raw: unknown) => {
  const key = String(raw ?? "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^[^a-z]+/, "").replace(/_+$/, "").slice(0, 63)
  return /^[a-z][a-z0-9_]{1,62}$/.test(key) ? key : null
}

const coerceText = (raw: unknown, max: number) => (typeof raw === "string" ? raw.trim().slice(0, max) : "")

function coerceOne(raw: unknown): ParsedFieldSuggestion | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const key = coerceKey(source.key)
  const label = coerceText(source.label, 80)
  const value = coerceText(source.value, 300)
  if (!key || !label || !value) return null
  const type = typeof source.type === "string" && SUGGESTABLE_TYPES.has(source.type) ? (source.type as DocumentFieldDefinition["type"]) : "string"
  const instruction = coerceText(source.instruction, 500)
  const quote = coerceText(source.quote, 120)
  const confidence = typeof source.confidence === "number" && Number.isFinite(source.confidence) ? Math.max(0, Math.min(1, source.confidence)) : null
  // documentFieldSchema is the same shape the template itself is validated against, so a proposal
  // that would not survive being saved as a real field definition is dropped here rather than
  // stored and failing later when someone tries to approve it.
  const definitionCheck = documentFieldSchema.safeParse({ key, label, type, instruction, required: false })
  if (!definitionCheck.success) return null
  return { key, label, type, instruction, value, quote, confidence }
}

/** Turns the model's raw `_suggested_fields` output into validated proposals.
 *
 * `existingKeys` is the current template's field keys: a "suggestion" that reuses one of them is
 * not a new field, it is the model failing to use the field it already had — dropped rather than
 * stored, since surfacing it as an "approve this" choice would just be confusing. Duplicate keys
 * within the output itself keep only the first. */
export function parseSuggestedTranscriptFields(output: unknown, existingKeys: Set<string>): ParsedFieldSuggestion[] {
  if (!output || typeof output !== "object" || Array.isArray(output)) return []
  const raw = (output as Record<string, unknown>)._suggested_fields
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>(existingKeys)
  const result: ParsedFieldSuggestion[] = []
  for (const entry of raw) {
    const parsed = coerceOne(entry)
    if (!parsed || seen.has(parsed.key)) continue
    seen.add(parsed.key)
    result.push(parsed)
    if (result.length >= MAX_SUGGESTIONS) break
  }
  return result
}
