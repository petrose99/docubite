import type { DocumentFieldDefinition, DocumentItemFieldDefinition } from "@/lib/document-templates"
import type { AudioProvenance, AudioRef } from "@/lib/provenance-audio"
import type { DocumentProvenance, Ref } from "@/lib/provenance"

/** Projects a document's extracted values into flat, typed rows for document_field_values.
 *
 * Pure and DB-free on purpose — the whole point of the projection is that it is decided by the
 * template field DSL alone, so it can be asserted in a unit test without a database and reused
 * unchanged by the extraction path, the manual-edit path, and the backfill script.
 *
 * The typing rules deliberately mirror validateDocumentValues: a value that survived validation is
 * already the right shape for its declared type, so this never re-coerces or rescues a bad one. A
 * value that does not match its declared type produces no row rather than a wrong one. */

/** How a stored fact was obtained. */
export type FieldValueSource = "vlm_ocr" | "asr" | "llm_structured" | "manual"

/** One row destined for document_field_values, before workspace/document/file ids are attached. */
export type FieldValueRow = {
  fieldKey: string
  /** Null for scalars; the field inside one array row otherwise. */
  itemKey: string | null
  /** Null for scalars; the array row's position otherwise. */
  rowIndex: number | null
  valueText: string | null
  valueNumber: number | null
  /** ISO YYYY-MM-DD — cast to DATE at insert. */
  valueDate: string | null
  valueBool: boolean | null
  source: FieldValueSource
  sourceConfidence: number | null
  /** Where this value came from in its source. A page rectangle for a scanned document, a time
   * span for a dictation — the two never mix within one document, and the column is jsonb, so both
   * shapes are stored as-is rather than being flattened into a lossy common one. */
  provenance: Ref | AudioRef | null
}

const EMPTY_VALUE: Pick<FieldValueRow, "valueText" | "valueNumber" | "valueDate" | "valueBool"> = {
  valueText: null, valueNumber: null, valueDate: null, valueBool: null,
}

/** Places a validated value into the one column its declared type belongs in, or returns null when
 * the value does not match that type (so nothing is stored rather than something wrong). Enums and
 * dates are both text-typed in Postgres; dates additionally go to value_date so ranges work. */
function typedColumns(field: DocumentFieldDefinition | DocumentItemFieldDefinition, raw: unknown): typeof EMPTY_VALUE | null {
  const type = field.type
  if (raw === undefined || raw === null || raw === "") return null
  if (type === "number") return typeof raw === "number" && Number.isFinite(raw) ? { ...EMPTY_VALUE, valueNumber: raw } : null
  if (type === "boolean") return typeof raw === "boolean" ? { ...EMPTY_VALUE, valueBool: raw } : null
  // An enum value outside its declared options is dropped, exactly as validateDocumentValues drops
  // it — otherwise a filter on the enum would return rows the template says cannot exist.
  if (type === "enum") return typeof raw === "string" && field.options?.includes(raw) ? { ...EMPTY_VALUE, valueText: raw } : null
  if (type === "date") {
    if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) return null
    // Kept in value_text too, so a date reads back as the literal string the document showed
    // without a timezone round-trip through DATE.
    return { ...EMPTY_VALUE, valueDate: raw, valueText: raw }
  }
  if (type === "string") return typeof raw === "string" && raw.trim() ? { ...EMPTY_VALUE, valueText: raw.trim() } : null
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export type ProjectionInput = {
  fields: DocumentFieldDefinition[]
  /** The document's stored values — reviewedData, or rawExtraction as its fallback. */
  values: Record<string, unknown>
  /** Per-field 0-1 scores from confidence.fieldConfidence, if any. */
  confidence?: Record<string, number> | null
  /** The document's resolved provenance record, if any — page rectangles for a scanned document,
   * time spans for a dictation. Both have the same {fields, items} shape, so the projection walks
   * them identically and simply carries whichever Ref it finds. */
  provenance?: DocumentProvenance | AudioProvenance | null
  source: FieldValueSource
}

/** Flattens one document's values into rows: one per scalar field that has a value, and one per
 * item field per row for array fields. Array rows carry their row_index, which is what lets a
 * line-item SKU be filtered exactly like a top-level vendor. */
export function projectDocumentFields(input: ProjectionInput): FieldValueRow[] {
  const { fields, values, source } = input
  const confidence = input.confidence ?? {}
  const provenanceFields = input.provenance?.fields ?? {}
  const provenanceItems = input.provenance?.items ?? {}
  const rows: FieldValueRow[] = []

  for (const field of fields) {
    const raw = values[field.key]
    const fieldConfidence = typeof confidence[field.key] === "number" ? confidence[field.key] : null

    if (field.type === "array") {
      const itemFields: DocumentItemFieldDefinition[] = field.itemFields ?? []
      if (!itemFields.length || !Array.isArray(raw)) continue
      // One provenance Ref per array row, index-aligned with the rows themselves — the same
      // alignment the extraction pipeline maintains — so every item field of a row cites that row.
      const hints = provenanceItems[field.key] ?? []
      raw.forEach((row, rowIndex) => {
        if (!isRecord(row)) return
        for (const itemField of itemFields) {
          const columns = typedColumns(itemField, row[itemField.key])
          if (!columns) continue
          rows.push({
            fieldKey: field.key, itemKey: itemField.key, rowIndex,
            ...columns,
            source,
            // Array fields get one score for the whole array, so every row inherits it: there is
            // no per-row score to be had, and inheriting is more honest than reporting none.
            sourceConfidence: fieldConfidence,
            provenance: hints[rowIndex] ?? null,
          })
        }
      })
      continue
    }

    const columns = typedColumns(field, raw)
    if (!columns) continue
    rows.push({
      fieldKey: field.key, itemKey: null, rowIndex: null,
      ...columns,
      source,
      sourceConfidence: fieldConfidence,
      provenance: provenanceFields[field.key] ?? null,
    })
  }
  return rows
}
