import { requestLLM } from "@/ai/providers/llmProvider"
import config from "@/lib/config"
import { buildBatchParts, normalizeForMineru, PageContent } from "@/lib/document-processing"
import { DocumentFieldDefinition, DocumentItemFieldDefinition, documentItemFieldsSchema, documentTemplateFieldsSchema } from "@/lib/document-templates"
import { parseDocumentWithMineru } from "@/lib/mineru"

/** Line-item discovery (lib/adaptive-extraction.ts) only looks at the pages the extraction job
 * already parsed, so it never re-runs MinerU. Capped at page 2 for the same reason as
 * SUGGESTION_SAMPLE_RANGE above: column layout is visible early, and reading further only adds
 * latency. */
const ITEM_DISCOVERY_MAX_PAGE = 2

/** How many pages of the sampled document the suggestion pass reads. Column layout is
 * almost always visible on page 1; page 2 catches line-item tables that start below a
 * long header. Reading more only adds latency to an interactive step. */
const SUGGESTION_SAMPLE_RANGE = "1-2"
const FIELD_TYPES = new Set(["string", "number", "date", "boolean", "array", "enum"])

export type SuggestedSheet = { name: string; prompt: string; fields: DocumentFieldDefinition[] }

export function buildFieldSuggestionPrompt() {
  return [
    "You are configuring a data-extraction sheet: users upload documents like this one and an extractor fills one spreadsheet column per field you define.",
    "Study the sampled pages and propose the extraction setup a careful analyst would want for documents of this kind.",
    "Rules:",
    "- Propose between 3 and 12 fields. Keys are snake_case (letters, digits, underscores; must start with a letter). Labels are short Title Case column headers.",
    "- Allowed types: string, number, date, boolean, enum, array. Amounts and quantities are number. Dates are date. Use enum only for a small closed set of values, and then list the options.",
    "- If the document contains a repeating table (line items, transactions, rows), define exactly one array field for it with item_fields describing the table's columns (types: string, number, date, boolean, enum).",
    "- Every field gets a one-sentence instruction telling the extractor exactly what to read.",
    "- Mark a field required only when every document of this kind must contain it.",
    "- Also propose template_name (2-4 words naming this document kind) and extra_instructions: 1-3 sentences of extraction guidance for ALL documents of this kind (e.g. row handling, number formatting). Never mention a specific vendor or value from the sample.",
  ].join("\n")
}

export function buildSingleColumnPrompt(description: string) {
  return [
    "You are adding one column to an existing data-extraction sheet: users upload documents like this one and an extractor fills one spreadsheet column per field.",
    `The user described the column they want as: "${description.trim()}"`,
    "Propose exactly one field capturing that. Rules:",
    "- fields must contain exactly one entry. Key is snake_case (starts with a letter). Label is a short Title Case column header.",
    "- Allowed types: string, number, date, boolean, enum, array (array only for a repeating table, with item_fields for its columns).",
    "- Give the field a one-sentence instruction telling the extractor exactly what to read.",
    "- Leave template_name and extra_instructions empty.",
  ].join("\n")
}

const suggestedItemField = {
  type: "object",
  properties: {
    key: { type: "string", description: "snake_case key" },
    label: { type: "string", description: "Short column header" },
    type: { type: "string", enum: ["string", "number", "date", "boolean", "enum"], description: "Value type" },
    instruction: { type: "string", description: "One sentence telling the extractor what to read" },
    required: { type: "boolean", description: "Whether every row must contain this value" },
    options: { type: "array", items: { type: "string" }, description: "Allowed values; only for enum type" },
  },
  required: ["key", "label", "type"],
  additionalProperties: false,
}

export const fieldSuggestionJsonSchema = {
  type: "object",
  properties: {
    template_name: { type: "string", description: "2-4 word name for this document kind" },
    extra_instructions: { type: "string", description: "1-3 sentences of extraction guidance for all documents of this kind" },
    fields: {
      type: "array",
      description: "Proposed extraction fields, one spreadsheet column each",
      items: {
        type: "object",
        properties: {
          key: { type: "string", description: "snake_case key" },
          label: { type: "string", description: "Short Title Case column header" },
          type: { type: "string", enum: ["string", "number", "date", "boolean", "enum", "array"], description: "Value type; array for a repeating table" },
          instruction: { type: "string", description: "One sentence telling the extractor what to read" },
          required: { type: "boolean", description: "Whether every document of this kind must contain this value" },
          options: { type: "array", items: { type: "string" }, description: "Allowed values; only for enum type" },
          item_fields: { type: "array", items: suggestedItemField, description: "Table columns; only for array type" },
        },
        required: ["key", "label", "type"],
        additionalProperties: false,
      },
    },
  },
  required: ["fields"],
  additionalProperties: false,
}

const coerceKey = (raw: unknown) => {
  const key = String(raw ?? "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^[^a-z]+/, "").replace(/_+$/, "").slice(0, 63)
  return /^[a-z][a-z0-9_]{1,62}$/.test(key) ? key : null
}

const coerceText = (raw: unknown, max: number) => (typeof raw === "string" ? raw.trim().slice(0, max) : "")

function coerceField(raw: unknown, allowArray: boolean): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const key = coerceKey(source.key)
  const label = coerceText(source.label, 80)
  if (!key || !label) return null
  const type = typeof source.type === "string" && FIELD_TYPES.has(source.type) && (allowArray || source.type !== "array") ? source.type : "string"
  const options = Array.isArray(source.options) ? source.options.filter((option): option is string => typeof option === "string" && !!option.trim()).map((option) => option.trim().slice(0, 80)).slice(0, 50) : []
  const field: Record<string, unknown> = { key, label, type, instruction: coerceText(source.instruction, 500), required: source.required === true }
  if (type === "enum") {
    if (!options.length) field.type = "string"
    else field.options = options
  }
  if (field.type === "array") {
    const itemsRaw = Array.isArray(source.item_fields) ? source.item_fields : Array.isArray(source.itemFields) ? source.itemFields : []
    const seen = new Set<string>()
    const itemFields = itemsRaw.map((item) => coerceField(item, false)).filter((item): item is Record<string, unknown> => !!item && !seen.has(item.key as string) && !!seen.add(item.key as string)).slice(0, 20)
    if (!itemFields.length) return null
    field.itemFields = itemFields
  }
  return field
}

/** Turns raw LLM output into a validated sheet proposal, coercing sloppy keys and types and
 * dropping entries that cannot be repaired. Returns null when nothing usable survives. */
export function parseSuggestedFields(output: unknown): SuggestedSheet | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null
  const source = output as Record<string, unknown>
  const rawFields = Array.isArray(source.fields) ? source.fields : []
  const seen = new Set<string>()
  const coerced = rawFields.map((raw) => coerceField(raw, true)).filter((field): field is Record<string, unknown> => !!field && !seen.has(field.key as string) && !!seen.add(field.key as string)).slice(0, 50)
  const parsed = documentTemplateFieldsSchema.safeParse(coerced)
  if (!parsed.success || !parsed.data.length) return null
  return { name: coerceText(source.template_name, 80), prompt: coerceText(source.extra_instructions, 2000), fields: parsed.data }
}

/** Parses the first pages of an uploaded document with MinerU, without calling the LLM. Split out
 * so the suggestion flow can fingerprint the sample and check it against saved shapes before
 * deciding whether an LLM suggestion (and its quota charge) is needed at all. */
export async function sampleDocumentPages(input: { buffer: Buffer; mimeType: string; filename: string }): Promise<PageContent[]> {
  const isPdf = input.mimeType === "application/pdf"
  const upload = await normalizeForMineru(input.buffer, input.mimeType, input.filename)
  const parsed = await parseDocumentWithMineru({ buffer: upload.buffer, filename: upload.filename, pageRanges: isPdf ? SUGGESTION_SAMPLE_RANGE : null })
  return parsed.pages?.length ? parsed.pages : [{ page: 1, text: parsed.markdown }]
}

/** Asks the LLM to propose the sheet's columns from already-parsed pages — or, with `singleColumn`,
 * one column from the user's plain-English description. */
export async function suggestFieldsFromContents(contents: PageContent[], input: { singleColumn?: string } = {}): Promise<SuggestedSheet> {
  const aiProvider = config.ai.provider
  const apiKey = aiProvider === "gemini" ? config.ai.geminiApiKey : config.ai.openaiApiKey
  const modelName = aiProvider === "gemini" ? config.ai.geminiModelName : config.ai.openaiModelName
  if (!apiKey) throw new Error("platform_ai_not_configured")
  const { textParts } = buildBatchParts(contents, contents.map((content) => content.page))
  const prompt = input.singleColumn?.trim() ? buildSingleColumnPrompt(input.singleColumn) : buildFieldSuggestionPrompt()
  const response = await requestLLM({ providers: [{ provider: aiProvider, apiKey, model: modelName }] }, { prompt, schema: fieldSuggestionJsonSchema, textParts })
  if (response.error) throw new Error(response.error)
  const suggested = parseSuggestedFields(response.output)
  if (!suggested) throw new Error("ai_suggestion_failed")
  return suggested
}

/** Samples the first pages of an uploaded document and asks the LLM to propose the sheet's
 * columns — or, with `singleColumn`, one column from the user's plain-English description. */
export async function suggestFieldsFromBuffer(input: { buffer: Buffer; mimeType: string; filename: string; singleColumn?: string }): Promise<SuggestedSheet> {
  const contents = await sampleDocumentPages(input)
  return suggestFieldsFromContents(contents, { singleColumn: input.singleColumn })
}

export function buildLineItemDiscoveryPrompt(baseItemFields: DocumentItemFieldDefinition[]) {
  const knownKeys = baseItemFields.map((field) => `${field.key} (${field.label})`).join(", ") || "none"
  return [
    "You are looking at a document's repeating line-item table (invoice/receipt/order rows).",
    `The extraction sheet already has these row columns defined: ${knownKeys}.`,
    "Study the table in the sampled pages and propose the FULL set of row columns it actually has.",
    "Rules:",
    "- For each already-defined column above whose concept appears in this table, keep its EXACT key unchanged.",
    "- For every OTHER column the table visibly has that is not already covered (e.g. a product code, SKU, country of origin, color, size, tax rate, discount), add one new field for it.",
    "- Keys are snake_case (letters, digits, underscores; must start with a letter) and must not collide with an existing key unless you mean to reuse it.",
    "- Allowed types: string, number, date, boolean, enum. Use enum only for a small closed set of values, and then list the options.",
    "- Give each new field a one-sentence instruction telling the extractor exactly what to read.",
    "- Propose at most 20 fields total (existing kept ones plus new ones).",
    "- Do not invent columns the table does not have. If the table has no columns beyond what's already defined, return only the existing ones unchanged.",
  ].join("\n")
}

export const lineItemDiscoveryJsonSchema = {
  type: "object",
  properties: {
    item_fields: { type: "array", items: suggestedItemField, description: "The row's full set of columns: kept existing keys plus any new ones the table actually has" },
  },
  required: ["item_fields"],
  additionalProperties: false,
}

/** Discovers a document's actual line-item table columns, for lib/adaptive-extraction.ts to merge
 * into a template's array field. Reuses the extraction job's already-parsed pages (no second MinerU
 * parse) and the same requestLLM provider/schema machinery as suggestFieldsFromContents. Never
 * throws: any failure (no AI configured, LLM error, garbage output) returns `baseItemFields`
 * unchanged, so a discovery failure degrades to today's fixed-template behavior rather than
 * blocking extraction. */
export async function discoverItemFields(contents: PageContent[], baseItemFields: DocumentItemFieldDefinition[]): Promise<DocumentItemFieldDefinition[]> {
  try {
    const aiProvider = config.ai.provider
    const apiKey = aiProvider === "gemini" ? config.ai.geminiApiKey : config.ai.openaiApiKey
    const modelName = aiProvider === "gemini" ? config.ai.geminiModelName : config.ai.openaiModelName
    if (!apiKey) return baseItemFields
    const sampled = contents.filter((content) => content.page <= ITEM_DISCOVERY_MAX_PAGE)
    if (!sampled.length) return baseItemFields
    const { textParts } = buildBatchParts(sampled, sampled.map((content) => content.page))
    const prompt = buildLineItemDiscoveryPrompt(baseItemFields)
    const response = await requestLLM({ providers: [{ provider: aiProvider, apiKey, model: modelName }] }, { prompt, schema: lineItemDiscoveryJsonSchema, textParts })
    if (response.error) return baseItemFields
    const output = response.output && typeof response.output === "object" && !Array.isArray(response.output) ? (response.output as Record<string, unknown>) : {}
    const rawItemFields = Array.isArray(output.item_fields) ? output.item_fields : []
    const seen = new Set<string>()
    const coerced = rawItemFields.map((raw) => coerceField(raw, false)).filter((field): field is Record<string, unknown> => !!field && !seen.has(field.key as string) && !!seen.add(field.key as string)).slice(0, 20)
    const parsed = documentItemFieldsSchema.safeParse(coerced)
    if (!parsed.success || !parsed.data.length) return baseItemFields
    return parsed.data
  } catch {
    return baseItemFields
  }
}
