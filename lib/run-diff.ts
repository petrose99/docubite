import type { DocumentFieldDefinition } from "@/lib/document-templates"

export type ScalarAdded = { key: string; label: string; after: unknown }
export type ScalarMissing = { key: string; label: string; before: unknown }
export type ScalarChange = { key: string; label: string; before: unknown; after: unknown }
export type ItemDelta = { addedRows: number; removedRows: number; changedCells: number }

/** What changed between two extractions of the same shape: scalar fields that appeared, vanished,
 * or changed value, plus a coarse count of line-item row and cell deltas. `items` is null when the
 * shape has no array field. */
export type RunDiff = {
  added: ScalarAdded[]
  missing: ScalarMissing[]
  changed: ScalarChange[]
  items: ItemDelta | null
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ""
}

/** Compares two scalar values as the sheet would show them: numbers numerically, everything else
 * as its trimmed string, so "Acme " and "Acme" are the same but a real change is caught. */
function sameScalar(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b
  return String(a).trim() === String(b).trim()
}

function asRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === "object") : []
}

/** Diffs the previous extraction against the next one, field by field. Deterministic and
 * index-aligned: line-item rows are compared position for position (no fuzzy row matching), so a
 * row inserted in the middle reads as a run of changed cells plus one added row — enough to point
 * a reviewer at what moved without pretending to a certainty the data does not support. */
export function diffExtractions(fields: DocumentFieldDefinition[], prev: Record<string, unknown>, next: Record<string, unknown>): RunDiff {
  const added: ScalarAdded[] = []
  const missing: ScalarMissing[] = []
  const changed: ScalarChange[] = []
  const arrayFields = fields.filter((field) => field.type === "array" && field.itemFields?.length)
  let itemDelta: ItemDelta | null = arrayFields.length ? { addedRows: 0, removedRows: 0, changedCells: 0 } : null

  for (const field of fields) {
    if (field.type === "array") {
      if (!field.itemFields?.length || !itemDelta) continue
      const prevRows = asRows(prev[field.key])
      const nextRows = asRows(next[field.key])
      itemDelta.addedRows += Math.max(0, nextRows.length - prevRows.length)
      itemDelta.removedRows += Math.max(0, prevRows.length - nextRows.length)
      const shared = Math.min(prevRows.length, nextRows.length)
      for (let index = 0; index < shared; index++) {
        for (const item of field.itemFields) {
          const before = prevRows[index][item.key]
          const after = nextRows[index][item.key]
          if (hasValue(before) || hasValue(after)) {
            if (!sameScalar(before ?? "", after ?? "")) itemDelta.changedCells++
          }
        }
      }
      continue
    }
    const before = prev[field.key]
    const after = next[field.key]
    const hadBefore = hasValue(before)
    const hasAfter = hasValue(after)
    if (hasAfter && !hadBefore) added.push({ key: field.key, label: field.label, after })
    else if (hadBefore && !hasAfter) missing.push({ key: field.key, label: field.label, before })
    else if (hadBefore && hasAfter && !sameScalar(before, after)) changed.push({ key: field.key, label: field.label, before, after })
  }

  return { added, missing, changed, items: itemDelta }
}

/** True when a diff found nothing worth showing — used to decide whether the "same as last time"
 * flow reports "identical to the previous run" rather than an empty dialog. */
export function isEmptyDiff(diff: RunDiff): boolean {
  return !diff.added.length && !diff.missing.length && !diff.changed.length && (!diff.items || (!diff.items.addedRows && !diff.items.removedRows && !diff.items.changedCells))
}
