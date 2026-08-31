"use client"

import { LineItemsEditor } from "@/components/documents/line-items-editor"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { DocumentFieldDefinition } from "@/lib/document-templates"
import type { Ref } from "@/lib/provenance"
import { Crosshair, Pencil } from "lucide-react"

const LOW_CONFIDENCE = 0.6

/** One editable field, with a per-field extracted-vs-manual + confidence indicator — the
 * provenance-aware improvement over a plain review form. A field with a source pin
 * (document.provenance.fields[key]) is clickable: clicking it calls onFocusSource with that pin's
 * {page,bbox,quote}, which the split-pane's left viewer highlights. A field with no pin either
 * came from a person (source "manual") or never resolved to a spot on the page — either way there
 * is nothing to jump to, so it renders a plain "Manual" tag instead of a crosshair button. */
export function FieldRow({ field, value, confidence, ref: provenanceRef, onFocusSource }: {
  field: DocumentFieldDefinition
  value: unknown
  confidence: number | null
  ref: Ref | null
  onFocusSource: (target: { page: number; bbox: Ref["bbox"]; quote: string }) => void
}) {
  const lowConfidence = typeof confidence === "number" && confidence < LOW_CONFIDENCE
  // An array field's provenance lives per-row (document.provenance.items), not as one Ref the way
  // a scalar's does — a single Source/Manual tag for the whole table would be misleading, so the
  // grid just gets a plain label instead of the click-to-highlight affordance.
  const isArray = field.type === "array"

  return <div className={`space-y-1.5 rounded-md ${isArray ? "border-t border-stone-200 pt-4" : ""} ${lowConfidence ? "border border-amber-300 bg-amber-50/60 p-2" : ""}`}>
    <Label htmlFor={field.key} className="flex items-center gap-2">
      <span className={isArray ? "text-xs font-semibold uppercase tracking-wide text-stone-500" : undefined}>{field.label}{field.required ? " *" : ""}</span>
      {lowConfidence && <span className="text-xs font-normal text-amber-700">Low confidence</span>}
      {isArray ? null : provenanceRef ? (
        <button type="button" className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
          onClick={() => onFocusSource({ page: provenanceRef.page, bbox: provenanceRef.bbox, quote: provenanceRef.quote })}
          title="Jump to where this was read in the source">
          <Crosshair className="h-3 w-3" />Source
        </button>
      ) : (
        <span className="ml-auto inline-flex items-center gap-1 text-xs font-normal text-stone-400" title="No source pin — entered by hand or unresolved">
          <Pencil className="h-3 w-3" />Manual
        </span>
      )}
    </Label>
    {field.type === "boolean" ? (
      <label className="flex items-center gap-2 text-sm"><input id={field.key} name={field.key} type="checkbox" value="true" defaultChecked={value === true} />Yes</label>
    ) : field.type === "enum" ? (
      <select id={field.key} name={field.key} defaultValue={typeof value === "string" ? value : ""} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
        <option value="">Select a value</option>
        {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    ) : field.type === "array" ? (
      field.itemFields?.length
        ? <LineItemsEditor fieldKey={field.key} itemFields={field.itemFields} initialRows={Array.isArray(value) ? value as Array<Record<string, unknown>> : []} />
        : <textarea id={field.key} name={field.key} defaultValue={Array.isArray(value) ? JSON.stringify(value) : ""} placeholder="JSON array" className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm" />
    ) : (
      <Input id={field.key} name={field.key} type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} defaultValue={typeof value === "string" || typeof value === "number" ? String(value) : ""} />
    )}
  </div>
}
