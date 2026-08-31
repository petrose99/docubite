import { requestLLM } from "@/ai/providers/llmProvider"
import config from "@/lib/config"
import { buildBatchParts, normalizeForMineru, PageContent } from "@/lib/document-processing"
import { DocumentItemFieldDefinition, documentItemFieldsSchema } from "@/lib/document-templates"
import { parseDocumentWithMineru } from "@/lib/mineru"

/** Line-item discovery (lib/adaptive-extraction.ts) only looks at the pages the extraction job
 * already parsed, so it never re-runs MinerU. Capped at page 2 for the same reason as
 * SUGGESTION_SAMPLE_RANGE above: column layout is visible early, and reading further only adds
 * latency. */
const ITEM_DISCOVERY_MAX_PAGE = 2

/** How many pages of the sampled document a shape probe reads. Column layout is almost always
 * visible on page 1; page 2 catches line-item tables that start below a long header. Reading
 * more only adds latency to an interactive step. */
const SUGGESTION_SAMPLE_RANGE = "1-2"
const FIELD_TYPES = new Set(["string", "number", "date", "boolean", "array", "enum"])

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

/** Parses the first pages of an uploaded document with MinerU, without calling the LLM. Split out
 * so the upload flow can fingerprint the sample and check it against saved shapes before deciding
 * whether to offer a "same as last time?" reuse. */
export async function sampleDocumentPages(input: { buffer: Buffer; mimeType: string; filename: string }): Promise<PageContent[]> {
  const isPdf = input.mimeType === "application/pdf"
  const upload = await normalizeForMineru(input.buffer, input.mimeType, input.filename)
  const parsed = await parseDocumentWithMineru({ buffer: upload.buffer, filename: upload.filename, pageRanges: isPdf ? SUGGESTION_SAMPLE_RANGE : null })
  return parsed.pages?.length ? parsed.pages : [{ page: 1, text: parsed.markdown }]
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
 * parse). Never throws: any failure (no AI configured, LLM error, garbage output) returns
 * `baseItemFields` unchanged, so a discovery failure degrades to today's fixed-template behavior
 * rather than blocking extraction. */
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
