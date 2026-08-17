import type { DocumentFieldDefinition, DocumentItemFieldDefinition } from "@/lib/document-templates"

/** One flattened extracted value, ready to become a DocumentFieldValue row. `documentId`/
 * `workspaceId` are added by the sync helper; this pure module only produces the value shape. */
export type FieldValueRow = {
  fieldKey: string
  /** The array item field's key, or null for a scalar top-level value. */
  itemKey: string | null
  /** The array row index, or null for a scalar top-level value. */
  itemIndex: number | null
  label: string
  type: string
  /** Always present — the search column. String()d and capped. */
  valueText: string
  valueNumber: number | null
  /** A "YYYY-MM-DD" string when the value is a valid ISO date, else null. */
  valueDate: string | null
  valueBool: boolean | null
}

/** Hard cap on rows produced per document, so a pathological line-item table (a thousand-row
 * statement, say) can never blow up the sync's createMany. */
export const MAX_FIELD_VALUE_ROWS = 2000

/** Longest string stored in the search column. Generous enough for any real field value, short
 * enough that one runaway value cannot bloat the table. */
const VALUE_TEXT_LIMIT = 2000

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Coerces any value to the number column, tolerating the string numbers the LLM and legacy
 * reviewedData both produce ("1,234.50"). Returns null for anything non-finite. */
function coerceNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim()
    if (!cleaned) return null
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Coerces to the date column: only an exact "YYYY-MM-DD" that actually parses. Anything else is
 * null (the text form is still kept in valueText), so a garbled or non-ISO date never poisons a
 * date range filter. */
function coerceDate(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!ISO_DATE.test(trimmed) || Number.isNaN(Date.parse(`${trimmed}T00:00:00Z`))) return null
  return trimmed
}

/** Coerces to the boolean column: real booleans and the "true"/"false" strings legacy data holds. */
function coerceBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  if (value === "true") return true
  if (value === "false") return false
  return null
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "object") return JSON.stringify(value).slice(0, VALUE_TEXT_LIMIT)
  return String(value).slice(0, VALUE_TEXT_LIMIT)
}

/** Builds one row for a scalar value of a given type. Coercion never throws — an unexpected shape
 * simply lands in valueText with the typed columns left null. */
function scalarRow(fieldKey: string, itemKey: string | null, itemIndex: number | null, label: string, type: string, value: unknown): FieldValueRow {
  return {
    fieldKey,
    itemKey,
    itemIndex,
    label,
    type,
    valueText: valueText(value),
    valueNumber: type === "number" ? coerceNumber(value) : null,
    valueDate: type === "date" ? coerceDate(value) : null,
    valueBool: type === "boolean" ? coerceBool(value) : null,
  }
}

/** Flattens one document's extracted values into searchable rows, driven by the document's OWN
 * field snapshot (not the template's current version), so a document reads the same way it was
 * extracted even after its worksheet's columns changed.
 *
 * Never throws: an unknown key is skipped, a value of the wrong shape degrades to a text-only row,
 * and the total is capped at MAX_FIELD_VALUE_ROWS. Array fields with itemFields produce one row per
 * (itemIndex, itemKey); array fields without itemFields produce one text row per element. */
export function flattenDocumentValues(fields: DocumentFieldDefinition[], data: Record<string, unknown>): FieldValueRow[] {
  const rows: FieldValueRow[] = []
  const source = data && typeof data === "object" && !Array.isArray(data) ? data : {}

  const push = (row: FieldValueRow) => {
    if (rows.length < MAX_FIELD_VALUE_ROWS) rows.push(row)
  }

  for (const field of fields) {
    if (rows.length >= MAX_FIELD_VALUE_ROWS) break
    const raw = source[field.key]
    if (raw === undefined || raw === null || raw === "") continue

    if (field.type === "array") {
      if (!Array.isArray(raw)) continue
      const itemFields: DocumentItemFieldDefinition[] | undefined = "itemFields" in field ? field.itemFields : undefined
      if (itemFields?.length) {
        raw.forEach((entry, itemIndex) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return
          const row = entry as Record<string, unknown>
          for (const item of itemFields) {
            const cell = row[item.key]
            if (cell === undefined || cell === null || cell === "") continue
            push(scalarRow(field.key, item.key, itemIndex, item.label, item.type, cell))
          }
        })
      } else {
        // A bare array (no item fields): one searchable text row per element.
        raw.forEach((entry, itemIndex) => {
          if (entry === undefined || entry === null || entry === "") return
          push(scalarRow(field.key, null, itemIndex, field.label, "string", entry))
        })
      }
      continue
    }

    push(scalarRow(field.key, null, null, field.label, field.type, raw))
  }

  return rows
}
