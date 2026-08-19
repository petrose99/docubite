import { z } from "zod"

/** Deterministic synoptic rendering. NO LLM TOUCHES THIS FILE.
 *
 * The synoptic section of a pathology report is a fixed list of slots with fixed labels. Filling it
 * is a lookup, not a writing task, so it is done by lookup — which means there is no generative
 * step that could embellish, infer, or smooth over a gap. A slot with no dictated value renders as
 * a visible `[missing: <label>]` marker; it is never omitted, never inferred, and never filled from
 * a neighbouring value.
 *
 * That property is the reason this is separate from narrative.ts: the half of the report that must
 * be exactly what was said is produced by code that is incapable of saying anything else. */

export const synopticFieldSchema = z.object({
  /** Matches a key in the document's extracted values. */
  key: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  label: z.string().min(1).max(120),
  required: z.boolean().default(false),
  /** Optional unit appended to a numeric value, e.g. "mm", "%". */
  unit: z.string().max(16).optional(),
})

export const synopticFieldsSchema = z.array(synopticFieldSchema).min(1).max(100)
export type SynopticField = z.infer<typeof synopticFieldSchema>

export function parseSynopticFields(fields: unknown): SynopticField[] {
  return synopticFieldsSchema.parse(fields)
}

/** The marker a missing required slot renders as. Deliberately conspicuous and machine-greppable:
 * a reader must be able to see at a glance that the report is incomplete, and completeness checks
 * must be able to find them without re-deriving the logic. */
export const MISSING_MARKER = (label: string) => `[missing: ${label}]`

/** Formats one value for a synoptic line. Arrays of objects (IHC markers) render as one
 * "name: result" clause per row, so a repeated field stays readable on a single line without any
 * summarising judgement being applied to it. */
export function formatSynopticValue(value: unknown, unit?: string): string | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") return unit ? `${value} ${unit}` : String(value)
  if (typeof value === "string") return unit ? `${value.trim()} ${unit}` : value.trim()
  if (Array.isArray(value)) {
    const parts = value.map((row) => {
      if (row === null || typeof row !== "object" || Array.isArray(row)) return formatSynopticValue(row)
      const entries = Object.entries(row as Record<string, unknown>).filter(([, item]) => item !== null && item !== undefined && item !== "")
      if (!entries.length) return null
      // "name" leads when present; the rest follow as "key: value", so ER/positive/90% reads as
      // "ER: positive, 90" rather than as an opaque object dump.
      const named = entries.find(([key]) => key === "name")
      const rest = entries.filter(([key]) => key !== "name").map(([, item]) => formatSynopticValue(item)).filter(Boolean)
      return named ? `${formatSynopticValue(named[1])}${rest.length ? `: ${rest.join(", ")}` : ""}` : rest.join(", ")
    }).filter(Boolean)
    return parts.length ? parts.join("; ") : null
  }
  return null
}

export type SynopticLine = { key: string; label: string; value: string | null; missing: boolean; required: boolean }

export type SynopticRender = {
  lines: SynopticLine[]
  /** Labels of required slots with no value — the pre-sign-off checklist. */
  missingRequired: string[]
  text: string
}

/** Slots the document's values into the template's fields, in template order.
 *
 * Iterates the TEMPLATE, never the values: a value the template does not name cannot appear in the
 * output, so an unexpected extracted field can never leak into a clinical document. */
export function renderSynoptic(fields: SynopticField[], values: Record<string, unknown>): SynopticRender {
  const lines: SynopticLine[] = fields.map((field) => {
    const value = formatSynopticValue(values[field.key], field.unit)
    return { key: field.key, label: field.label, value, missing: value === null, required: field.required }
  })
  return {
    lines,
    missingRequired: lines.filter((line) => line.missing && line.required).map((line) => line.label),
    text: lines
      // An optional slot with nothing dictated is dropped; a REQUIRED one is never dropped, because
      // its absence is itself information the reader needs.
      .filter((line) => !line.missing || line.required)
      .map((line) => `${line.label}: ${line.value ?? MISSING_MARKER(line.label)}`)
      .join("\n"),
  }
}
