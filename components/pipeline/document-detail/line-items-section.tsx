"use client"

import { LineItemsEditor } from "@/components/documents/line-items-editor"
import type { DocumentFieldDefinition } from "@/lib/document-templates"
import type { Ref } from "@/lib/provenance"
import { Crosshair, Pencil } from "lucide-react"

/** One totals field rendered compactly inside the line-items footer strip (Subtotal, Tax total,
 * Total, or a bank statement's opening/closing balance) — the same Source/Manual affordance
 * FieldRow gives every other field, just laid out for a right-aligned summary row instead of a
 * full-width labeled block. Still a plain `name={field.key}` input, so it submits exactly like it
 * did as a standalone FieldRow. */
function TotalField({ field, value, ref: provenanceRef, onFocusSource }: {
  field: DocumentFieldDefinition
  value: unknown
  ref: Ref | null
  onFocusSource: (target: { page: number; bbox: Ref["bbox"]; quote: string }) => void
}) {
  return <div className="flex flex-col items-end gap-1">
    <div className="flex items-center gap-1.5 text-xs font-medium text-stone-500">
      {field.label}
      {provenanceRef ? (
        <button type="button" className="text-emerald-700 hover:text-emerald-800" title="Jump to where this was read in the source"
          onClick={() => onFocusSource({ page: provenanceRef.page, bbox: provenanceRef.bbox, quote: provenanceRef.quote })}>
          <Crosshair className="h-3 w-3" />
        </button>
      ) : (
        <Pencil className="h-3 w-3 text-stone-300" aria-label="No source pin — entered by hand or unresolved" />
      )}
    </div>
    <input id={field.key} name={field.key} type="number" step="any"
      className="w-32 rounded-md border border-stone-300 bg-white px-2 py-1 text-right text-sm tabular-nums"
      defaultValue={typeof value === "string" || typeof value === "number" ? String(value) : ""} />
  </div>
}

/** Line items plus the totals that summarize them, as one visual unit — Subtotal/Tax total/Total
 * (or a bank statement's opening/closing balance) sit right below the grid they total, rather
 * than scattered among the header-level supplier/date fields above. `summaryFields` is whichever
 * numeric fields the template declares immediately before the array field (see split-pane.tsx's
 * grouping) — a positional rule, not a hardcoded field-name list, so it generalizes to any
 * template whose author already put its summary numbers next to the array they summarize. */
export function LineItemsSection({ field, value, fieldKey, summaryFields, fieldValues, provenanceFields, onFocusSource }: {
  field: DocumentFieldDefinition
  value: unknown
  fieldKey: string
  summaryFields: DocumentFieldDefinition[]
  fieldValues: Record<string, unknown>
  provenanceFields: Record<string, Ref>
  onFocusSource: (target: { page: number; bbox: Ref["bbox"]; quote: string }) => void
}) {
  return <div className="space-y-3 border-t border-stone-200 pt-4">
    <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{field.label}</div>
    {field.itemFields?.length
      ? <LineItemsEditor fieldKey={fieldKey} itemFields={field.itemFields} initialRows={Array.isArray(value) ? value as Array<Record<string, unknown>> : []} />
      : <textarea id={fieldKey} name={fieldKey} defaultValue={Array.isArray(value) ? JSON.stringify(value) : ""} placeholder="JSON array" className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm" />}
    {summaryFields.length > 0 && <div className="flex flex-wrap justify-end gap-4 rounded-lg bg-stone-50 px-4 py-3">
      {summaryFields.map((summaryField) => <TotalField key={summaryField.key} field={summaryField} value={fieldValues[summaryField.key]} ref={provenanceFields[summaryField.key] ?? null} onFocusSource={onFocusSource} />)}
    </div>}
  </div>
}
