import { FINANCE_TEMPLATES } from "@/lib/domains/finance"
import { z } from "zod"

const fieldTypes = z.enum(["string", "number", "date", "boolean", "array", "enum"])
const itemFieldTypes = z.enum(["string", "number", "date", "boolean", "enum"])

/** Where in the document a scalar value belongs, which decides who wins when two extraction
 * passes over different page ranges both report one (see mergeExtractionPasses):
 * - "first" (the default): header data — vendor, invoice number, dates — printed on page 1.
 * - "last": a document-level summary printed *after* the content it summarizes, such as the
 *   totals row of a line-item table. An early batch that never saw the totals row can still
 *   report a plausible total by adding up the lines it can see, so the last pass to report a
 *   value wins over that guess. */
const fieldMergeStrategies = z.enum(["first", "last"])

function uniqueKeysRefinement(fields: Array<{ key: string }>, ctx: z.RefinementCtx) {
  const keys = new Set<string>()
  fields.forEach((field, index) => {
    if (keys.has(field.key)) ctx.addIssue({ code: "custom", path: [index, "key"], message: "Field keys must be unique" })
    keys.add(field.key)
  })
}

export const documentItemFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  label: z.string().min(1).max(80),
  type: itemFieldTypes.default("string"),
  instruction: z.string().max(500).default(""),
  required: z.boolean().default(false),
  options: z.array(z.string().min(1).max(80)).max(50).optional(),
}).superRefine((field, ctx) => {
  if (field.type === "enum" && !field.options?.length) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "Enum fields need at least one option" })
  }
  if (field.type !== "enum" && field.options?.length) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "Only enum fields can have options" })
  }
})

export const documentItemFieldsSchema = z.array(documentItemFieldSchema).min(1).max(20).superRefine(uniqueKeysRefinement)

export type DocumentItemFieldDefinition = z.infer<typeof documentItemFieldSchema>

export const documentFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  label: z.string().min(1).max(80),
  type: fieldTypes.default("string"),
  instruction: z.string().max(500).default(""),
  required: z.boolean().default(false),
  options: z.array(z.string().min(1).max(80)).max(50).optional(),
  itemFields: documentItemFieldsSchema.optional(),
  mergeStrategy: fieldMergeStrategies.optional(),
}).superRefine((field, ctx) => {
  if (field.type === "enum" && !field.options?.length) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "Enum fields need at least one option" })
  }
  if (field.type !== "enum" && field.options?.length) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "Only enum fields can have options" })
  }
  if (field.type !== "array" && field.itemFields?.length) {
    ctx.addIssue({ code: "custom", path: ["itemFields"], message: "Only array fields can have item fields" })
  }
  if (field.type === "array" && field.mergeStrategy) {
    ctx.addIssue({ code: "custom", path: ["mergeStrategy"], message: "Array fields always concatenate across pages, so they take no merge strategy" })
  }
})

export const documentTemplateFieldsSchema = z.array(documentFieldSchema).min(0).max(50).superRefine(uniqueKeysRefinement)

export type DocumentFieldDefinition = z.infer<typeof documentFieldSchema>

/** The templates seeded into every new file. Now sourced from the finance domain pack — the
 * definitions themselves are unchanged and unchanged in order, so this is a move, not an edit.
 * Other domain packs (pathology, logistics) are registered in lib/domains but deliberately NOT
 * included here: everything in this array becomes a worksheet in every file anyone creates. */
export const DEFAULT_DOCUMENT_TEMPLATES = FINANCE_TEMPLATES

export function parseTemplateFields(fields: unknown): DocumentFieldDefinition[] {
  return documentTemplateFieldsSchema.parse(fields)
}

export function validateDocumentValues(fields: DocumentFieldDefinition[] | DocumentItemFieldDefinition[], candidate: unknown): Record<string, unknown> {
  const source = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, unknown> : {}
  const value: Record<string, unknown> = {}
  for (const field of fields) {
    const raw = source[field.key]
    if (raw === undefined || raw === null || raw === "") continue
    if (field.type === "string" && typeof raw === "string") value[field.key] = raw.trim()
    if (field.type === "number" && typeof raw === "number" && Number.isFinite(raw)) value[field.key] = raw
    if (field.type === "boolean" && typeof raw === "boolean") value[field.key] = raw
    if (field.type === "array" && Array.isArray(raw)) {
      const itemFields = "itemFields" in field ? field.itemFields : undefined
      if (itemFields?.length) {
        const rows = raw
          .map((row) => validateDocumentValues(itemFields, row))
          .filter((row) => Object.keys(row).length > 0 && itemFields.every((item) => !item.required || row[item.key] !== undefined))
        if (rows.length) value[field.key] = rows
      } else {
        value[field.key] = raw
      }
    }
    if (field.type === "enum" && typeof raw === "string" && field.options?.includes(raw)) value[field.key] = raw
    if (field.type === "date" && typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) value[field.key] = raw
  }
  return value
}

/** Reads the model's `_confidence` object, clamped to [0, 1] per field key that exists in the schema. */
export function extractFieldConfidence(fields: DocumentFieldDefinition[], candidate: unknown): Record<string, number> {
  const source = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, unknown> : {}
  const confidenceSource = source._confidence && typeof source._confidence === "object" && !Array.isArray(source._confidence) ? source._confidence as Record<string, unknown> : {}
  const confidence: Record<string, number> = {}
  for (const field of fields) {
    const raw = confidenceSource[field.key]
    if (typeof raw === "number" && Number.isFinite(raw)) confidence[field.key] = Math.max(0, Math.min(1, raw))
  }
  return confidence
}

/** The model's claim about where a value was found: the page it appears on and a short verbatim
 * quote of the surrounding text. Both are hints — the deterministic resolver in lib/provenance
 * matches the quote against the parsed blocks to pin an actual rectangle, so a paraphrased or
 * absent quote degrades gracefully rather than failing. */
export type ProvenanceHint = { page: number | null; quote: string }
/** Per-field provenance hints for one extraction pass: scalar fields under `fields`, array
 * fields under `items` as one hint per row in row order (a row the model gave no hint for is a
 * null slot, keeping the list index-aligned with the extracted rows). */
export type FieldProvenanceHints = { fields: Record<string, ProvenanceHint>; items: Record<string, (ProvenanceHint | null)[]> }

const MAX_QUOTE_LENGTH = 120

function coerceProvenanceHint(raw: unknown): ProvenanceHint | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const page = typeof source.page === "number" && Number.isInteger(source.page) && source.page > 0 ? source.page : null
  const quote = typeof source.quote === "string" ? source.quote.trim().slice(0, MAX_QUOTE_LENGTH) : ""
  if (page === null && !quote) return null
  return { page, quote }
}

/** A domain-agnostic label for a document, read alongside its values: a generic type, the issuing
 * entity as printed, and the period it covers. Drives same-shape matching (F2) and the folder
 * report's grouping and gap detection (F3). Every field defaults to "" when unavailable. */
export type DocumentClassification = { docType: string; entity: string; period: string }

const CLASSIFICATION_MAX = 80

/** Reads the model's `_classification` object into a clamped {docType, entity, period}, tolerating
 * missing or non-string values by defaulting them to "". */
export function extractClassification(candidate: unknown): DocumentClassification {
  const source = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, unknown> : {}
  const classification = source._classification && typeof source._classification === "object" && !Array.isArray(source._classification) ? source._classification as Record<string, unknown> : {}
  const clean = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, CLASSIFICATION_MAX) : "")
  return { docType: clean(classification.doc_type), entity: clean(classification.entity), period: clean(classification.period) }
}

/** Reads the model's `_provenance` object into page+quote hints, tolerating garbage: unknown
 * keys are ignored, malformed entries drop to null, and array fields keep one (possibly null)
 * slot per reported row so the hints line up with the extracted rows. */
export function extractFieldProvenance(fields: DocumentFieldDefinition[], candidate: unknown): FieldProvenanceHints {
  const source = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate as Record<string, unknown> : {}
  const provSource = source._provenance && typeof source._provenance === "object" && !Array.isArray(source._provenance) ? source._provenance as Record<string, unknown> : {}
  const result: FieldProvenanceHints = { fields: {}, items: {} }
  for (const field of fields) {
    const raw = provSource[field.key]
    if (field.type === "array") {
      if (Array.isArray(raw)) result.items[field.key] = raw.map(coerceProvenanceHint)
    } else {
      const hint = coerceProvenanceHint(raw)
      if (hint) result.fields[field.key] = hint
    }
  }
  return result
}

type JsonSchemaProperty = {
  type: string
  items?: { type: string; properties?: Record<string, JsonSchemaProperty>; required?: string[]; additionalProperties: boolean }
  enum?: string[]
  description: string
}

function jsonSchemaProperty(field: DocumentFieldDefinition | DocumentItemFieldDefinition): JsonSchemaProperty {
  const itemFields = "itemFields" in field ? field.itemFields : undefined
  return {
    type: field.type === "date" || field.type === "enum" ? "string" : field.type,
    ...(field.type === "array" ? {
      items: itemFields?.length ? {
        type: "object",
        properties: Object.fromEntries(itemFields.map((item) => [item.key, jsonSchemaProperty(item)])),
        required: itemFields.filter((item) => item.required).map((item) => item.key),
        additionalProperties: false,
      } : { type: "object", additionalProperties: true },
    } : {}),
    ...(field.type === "enum" ? { enum: field.options } : {}),
    description: `${field.label}: ${field.instruction}`,
  }
}

/** One source-location hint: the page a value sits on and a short verbatim quote around it. */
const provenanceEntrySchema = {
  type: "object",
  properties: {
    page: { type: "number", description: "1-based page number the value appears on" },
    quote: { type: "string", description: "Short verbatim quote (under 120 chars) of the text around the value" },
  },
  required: [],
  additionalProperties: false,
} as const

export function buildDocumentJsonSchema(fields: DocumentFieldDefinition[]) {
  // With no fields (discover-mode dictation, lib/field-suggestions.ts), _confidence and _provenance
  // would each be `{ type: "object", properties: {}, additionalProperties: false }` — a structured-
  // output schema with no way to ever put anything in it, which providers reject outright. Omitting
  // both keys is correct anyway: there is nothing to score or cite yet, since every value in this
  // pass arrives only via `_suggested_fields`, which carries its own confidence and quote per entry.
  return {
    type: "object",
    properties: {
      ...Object.fromEntries(fields.map((field) => [field.key, jsonSchemaProperty(field)])),
      ...(fields.length ? {
        _confidence: {
          type: "object",
          properties: Object.fromEntries(fields.map((field) => [field.key, { type: "number", description: "Confidence from 0 to 1 that this value is correct" }])),
          additionalProperties: false,
          description: "A confidence score from 0 to 1 for each top-level field above",
        },
        // Listed last, after every value property, so a salvage truncation of an over-long response
        // drops provenance before it drops any extracted value.
        _provenance: {
          type: "object",
          properties: Object.fromEntries(fields.map((field) => [field.key, field.type === "array"
            ? { type: "array", items: provenanceEntrySchema, description: "One source-location entry per row, in the same order as the rows" }
            : provenanceEntrySchema])),
          additionalProperties: false,
          description: "For each field above, where in the document the value was found (page and a short verbatim quote)",
        },
      } : {}),
      _classification: {
        type: "object",
        properties: {
          doc_type: { type: "string", description: "Generic 2-4 word label for this kind of document" },
          entity: { type: "string", description: "The issuing organization or person, as printed" },
          period: { type: "string", description: "The YYYY-MM period this document covers, if any" },
        },
        additionalProperties: false,
        description: "A domain-agnostic classification of the whole document",
      },
    },
    required: fields.filter((field) => field.required).map((field) => field.key),
    additionalProperties: false,
  }
}

/** WP1.3's few-shot correction block: a bounded, format-guidance-only rendering of this
 * workspace's most-reinforced past corrections. Capped at ~2KB total on top of the 8-example/
 * 200-char-value caps already applied by getFewShotExamples, so a pathological workspace can never
 * blow out the prompt — examples are dropped from the end once the cap is hit, not truncated
 * mid-line. Phrased as "never reuse the values" deliberately: these are prior DOCUMENTS' answers,
 * and the model must not anchor on them as if this document repeats the same facts. */
const FEW_SHOT_BLOCK_CHAR_CAP = 2000

function buildFewShotBlock(examples: { fieldKey: string; wrongValue: string; correctedValue: string }[]): string {
  if (!examples.length) return ""
  const lines: string[] = ["Common corrections in this workspace (these show the expected format — never reuse the values):"]
  for (const example of examples) {
    const line = `- ${example.fieldKey}: "${example.wrongValue}" was corrected to "${example.correctedValue}"`
    if (lines.join("\n").length + line.length + 1 > FEW_SHOT_BLOCK_CHAR_CAP) break
    lines.push(line)
  }
  return lines.length > 1 ? lines.join("\n") : ""
}

export function buildDocumentPrompt(templateName: string, fields: DocumentFieldDefinition[], customPrompt?: string | null, fewShotExamples?: { fieldKey: string; wrongValue: string; correctedValue: string }[]) {
  return [
    `Extract factual values from this ${templateName}.`,
    "Return only values supported by the schema. Do not invent values; omit unreadable values.",
    "Dates use YYYY-MM-DD. Amounts are plain numbers. Never convert currencies.",
    "Keep every string value short and factual (under 300 characters). Never repeat text.",
    "The document is supplied as markdown produced by a document-parsing service, with tables rendered as markdown or HTML. Parsing can introduce recognition errors, so where a value looks garbled, extract the most plausible reading of it.",
    "For array fields (such as line items): if the document contains a table of items, you MUST extract every row as one entry. Do not omit, summarize, or truncate rows.",
    "Fields:",
    ...fields.flatMap((field) => [
      `- ${field.key} (${field.type}${field.required ? ", required" : ""}): ${field.instruction || field.label}`,
      ...(field.itemFields?.length ? field.itemFields.map((item) => `  - ${item.key} (${item.type}${item.required ? ", required" : ""}): ${item.instruction || item.label}`) : []),
    ]),
    "Also return a `_confidence` object with a 0-1 confidence score for each top-level field, reflecting how certain you are that the extracted value is correct.",
    "Also return a `_provenance` object: for each field, the 1-based page number the value appears on and a short verbatim quote (under 120 characters) of the text around it. For array fields, give one entry per row in the same order as the rows.",
    "Also return a `_classification` object: doc_type (a generic 2-4 word label for this kind of document), entity (the issuing organization or person as printed), and period (the YYYY-MM this document covers, if any).",
    customPrompt?.trim() ? `Workspace instructions:\n${customPrompt.trim()}` : "",
    fewShotExamples?.length ? buildFewShotBlock(fewShotExamples) : "",
  ].filter(Boolean).join("\n")
}

export function findMissingRequiredFields(fields: DocumentFieldDefinition[], value: Record<string, unknown>) {
  return fields.filter((field) => field.required && (value[field.key] === undefined || value[field.key] === null || value[field.key] === "")).map((field) => field.key)
}
