import { requestLLM } from "@/ai/providers/llmProvider"
import config from "@/lib/config"
import { listWorkspaceFieldKeys, type FieldFilter, type FieldFilterOp, type WorkspaceFieldKey } from "@/models/document-field-values"

/** Splits a natural-language query into structured pre-filters plus the semantic remainder.
 *
 * "invoices from Acme over £1000 last March" is two questions wearing one coat: an exact,
 * checkable part (vendor = Acme, total > 1000, a date range) and a fuzzy part (whatever else the
 * user meant). Embedding the whole string makes the exact part fuzzy too, which is how a
 * pure-semantic search returns the right-looking invoice from the wrong vendor.
 *
 * THE ROUTER CAN ONLY EVER NARROW, NEVER BREAK. Every failure path — feature off, no field
 * vocabulary, LLM error, unparseable output, a filter naming a field this workspace does not have —
 * returns `{filters: [], semanticQuery: <the original query>}`, which is byte-for-byte the input
 * today's retrieval already receives. There is no code path where a router failure produces a worse
 * search than not having a router. */

export type RoutedQuery = {
  /** Structured pre-filters to apply to both retrieval channels. Empty means "no constraint". */
  filters: FieldFilter[]
  /** What to embed and full-text search. Falls back to the raw query. */
  semanticQuery: string
  /** How the split was decided, for the eval harness and for debugging a surprising result. */
  via: "disabled" | "bare_identifier" | "no_field_vocabulary" | "llm" | "llm_failed" | "no_filters"
}

/** A query that is nothing but an identifier — "INV-2026-0042", "S26-1234", "GB33BUKB20201555555555".
 * The lexical channel already matches these verbatim (that is why it runs 'simple', not 'english'),
 * so routing one costs an LLM call to arrive at the same place. Caught before the model is asked. */
const BARE_IDENTIFIER = /^[A-Za-z0-9]+(?:[-_/][A-Za-z0-9]+)+$/

function passthrough(query: string, via: RoutedQuery["via"]): RoutedQuery {
  return { filters: [], semanticQuery: query, via }
}

/** The operators the router may emit. `exists` is offered so "which reports are missing a stage?"
 * can be routed (as a NOT EXISTS via neq semantics on the caller's side); `contains` covers partial
 * name matches the model would otherwise force into an exact eq. */
const ALLOWED_OPS: FieldFilterOp[] = ["eq", "neq", "contains", "gt", "gte", "lt", "lte", "exists"]

/** Describes the workspace's filterable fields to the model, one line each, with the value types
 * actually present. Types matter: telling the model `total` is numeric is what stops it emitting
 * `{op: "gt", value: "1000"}`, which would compare as text and quietly return nothing. */
function describeFields(keys: WorkspaceFieldKey[]): string {
  return keys.map((key) => {
    const types = [key.hasNumber && "number", key.hasDate && "date (YYYY-MM-DD)", key.hasBool && "boolean", key.hasText && "text"].filter(Boolean).join(" | ")
    const name = key.itemKey ? `${key.fieldKey}.${key.itemKey}` : key.fieldKey
    return `- ${name} (${types})${key.itemKey ? " [a field inside a repeated row]" : ""}`
  }).join("\n")
}

const ROUTER_SCHEMA = {
  type: "object",
  properties: {
    filters: {
      type: "array",
      description: "Conditions that must ALL hold. Empty when the query has no exactly checkable part.",
      items: {
        type: "object",
        properties: {
          field: { type: "string", description: "One of the listed field names, exactly as written (use dot notation for row fields)" },
          op: { type: "string", enum: ALLOWED_OPS, description: "Comparison operator" },
          value: { type: "string", description: "The value to compare against. A number as digits only; a date as YYYY-MM-DD. Omit for the exists operator." },
        },
        required: ["field", "op"],
        additionalProperties: false,
      },
    },
    semantic_query: {
      type: "string",
      description: "What remains of the question once the filters above are removed — the part that needs meaning-based search. Repeat the whole question if nothing was extracted.",
    },
  },
  required: ["filters", "semantic_query"],
  additionalProperties: false,
}

function buildRouterPrompt(query: string, keys: WorkspaceFieldKey[], today: string): string {
  return [
    "Split a search query over a document collection into exact filters plus a semantic remainder.",
    "",
    "The collection's filterable fields, with the value types present in each:",
    describeFields(keys),
    "",
    "Rules:",
    "- Only use field names from the list above. Never invent one. If the query names something not in the list, leave it in semantic_query instead.",
    "- Only emit a filter for a constraint the query states explicitly. Never infer one.",
    "- A numeric field takes digits only (no currency symbols, no thousands separators). A date field takes YYYY-MM-DD.",
    "- Express a period as two filters on the same field: gte its first day and lte its last day.",
    `- Today is ${today}; resolve relative dates ("last March", "this quarter") against it.`,
    "- semantic_query is what is left to search on meaning. If the query is entirely covered by filters, make it the subject being looked for (e.g. \"invoice\").",
    "- If nothing in the query is exactly checkable, return an empty filters array and the query unchanged.",
    "",
    `Query: ${query}`,
  ].join("\n")
}

/** Turns one model-proposed filter into a FieldFilter, or null.
 *
 * This is the gate that makes the router safe: a field the workspace does not have, an operator
 * outside the allowed set, or a value that cannot be coerced to the field's actual type is dropped
 * here rather than reaching the SQL. The model's output is treated as a suggestion to be validated,
 * never as a query to be executed. */
export function coerceRoutedFilter(raw: unknown, keys: WorkspaceFieldKey[]): FieldFilter | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const name = typeof source.field === "string" ? source.field.trim() : ""
  const op = typeof source.op === "string" ? source.op : ""
  if (!name || !ALLOWED_OPS.includes(op as FieldFilterOp)) return null

  const [fieldKey, itemKey = null] = name.split(".") as [string, string?]
  const known = keys.find((key) => key.fieldKey === fieldKey && (key.itemKey ?? null) === (itemKey ?? null))
  if (!known) return null

  if (op === "exists") return { fieldKey, itemKey, op: "exists" }

  const rawValue = source.value
  if (rawValue === undefined || rawValue === null || rawValue === "") return null
  const text = String(rawValue).trim()
  if (!text) return null

  // Coerce towards the types this field actually holds, in the order a filter is most likely to
  // mean. A range operator on a field with no numeric or date values is dropped outright: it would
  // fall through to a text comparison, which compares alphabetically and is never what was meant.
  const isRange = op === "gt" || op === "gte" || op === "lt" || op === "lte"
  if (known.hasDate && /^\d{4}-\d{2}-\d{2}$/.test(text)) return { fieldKey, itemKey, op: op as FieldFilterOp, value: text }
  if (known.hasNumber) {
    const numeric = Number(text.replace(/[^0-9.-]/g, ""))
    if (Number.isFinite(numeric)) return { fieldKey, itemKey, op: op as FieldFilterOp, value: numeric }
  }
  if (known.hasBool && (text === "true" || text === "false")) return { fieldKey, itemKey, op: op as FieldFilterOp, value: text === "true" }
  if (isRange) return null
  if (known.hasText) return { fieldKey, itemKey, op: op as FieldFilterOp, value: text }
  return null
}

/** Reads the model's response into a RoutedQuery. Exported for tests: this is where a malformed or
 * hallucinated response has to degrade to a passthrough rather than to a wrong search. */
export function parseRouterOutput(output: Record<string, unknown>, query: string, keys: WorkspaceFieldKey[]): RoutedQuery {
  const rawFilters = Array.isArray(output.filters) ? output.filters : []
  const filters = rawFilters.map((filter) => coerceRoutedFilter(filter, keys)).filter((filter): filter is FieldFilter => filter !== null)
  const proposed = typeof output.semantic_query === "string" ? output.semantic_query.trim() : ""
  // An empty semantic remainder would embed the empty string and full-text search nothing, so the
  // original query stands in — a filtered search still ranks within its filtered set.
  const semanticQuery = proposed || query
  return { filters, semanticQuery, via: filters.length ? "llm" : "no_filters" }
}

/** Routes one query. Never throws.
 *
 * `force` bypasses the RETRIEVAL_ROUTER_ENABLED gate. That flag exists to make routing opt-in for
 * *chunk* retrieval, which already works without it; the completeness channel (find_documents) has
 * no meaningful unrouted behaviour — with no filters it would return the whole workspace — so it
 * routes regardless. The bare-identifier shortcut is also skipped when forced, since there the
 * identifier IS the filter rather than something the lexical channel will catch. */
export async function routeQuery(workspaceId: string, query: string, options: { now?: Date; force?: boolean } = {}): Promise<RoutedQuery> {
  const trimmed = query.trim()
  if (!config.retrieval.routerEnabled && !options.force) return passthrough(trimmed, "disabled")
  if (!options.force && BARE_IDENTIFIER.test(trimmed)) return passthrough(trimmed, "bare_identifier")

  const apiKey = config.ai.provider === "gemini" ? config.ai.geminiApiKey : config.ai.openaiApiKey
  const model = config.ai.provider === "gemini" ? config.ai.geminiModelName : config.ai.openaiModelName
  if (!apiKey) return passthrough(trimmed, "disabled")

  try {
    const keys = await listWorkspaceFieldKeys(workspaceId)
    // No projected values means no vocabulary to filter on — every filter would be dropped by
    // coerceRoutedFilter anyway, so skip the LLM call entirely.
    if (!keys.length) return passthrough(trimmed, "no_field_vocabulary")

    const today = (options.now ?? new Date()).toISOString().slice(0, 10)
    const response = await requestLLM(
      { providers: [{ provider: config.ai.provider, apiKey, model }] },
      { prompt: buildRouterPrompt(trimmed, keys, today), schema: ROUTER_SCHEMA },
    )
    if (response.error) return passthrough(trimmed, "llm_failed")
    return parseRouterOutput(response.output, trimmed, keys)
  } catch (error) {
    console.error("query router: falling back to unrouted search:", error instanceof Error ? error.message : error)
    return passthrough(trimmed, "llm_failed")
  }
}
