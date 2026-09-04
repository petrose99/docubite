"use client"

import { LineItemsEditor } from "@/components/documents/line-items-editor"
import type { DocumentFieldDefinition } from "@/lib/document-templates"
import type { Ref } from "@/lib/provenance"
import { Crosshair, Pencil } from "lucide-react"

function TotalField({ field, value, ref: provenanceRef, onFocusSource }: {
  field: DocumentFieldDefinition
  value: unknown
  ref: Ref | null
  onFocusSource: (target: { page: number; bbox: Ref["bbox"]; quote: string }) => void
}) {
  return <div className="flex items-center gap-3">
    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
      {field.label}
      {provenanceRef ? (
        <button type="button" className="text-emerald-600 opacity-60 transition-opacity hover:opacity-100" title="Jump to where this was read in the source"
          onClick={() => onFocusSource({ page: provenanceRef.page, bbox: provenanceRef.bbox, quote: provenanceRef.quote })}>
          <Crosshair className="h-3 w-3" />
        </button>
      ) : (
        <Pencil className="h-2.5 w-2.5 text-slate-300" aria-label="No source pin — entered by hand or unresolved" />
      )}
    </div>
    <input id={field.key} name={field.key} type="number" step="any"
      className="w-28 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-right text-sm tabular-nums text-slate-800 shadow-sm transition-colors focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
      defaultValue={typeof value === "string" || typeof value === "number" ? String(value) : ""} />
  </div>
}

export function LineItemsSection({ field, value, fieldKey, summaryFields, fieldValues, provenanceFields, onFocusSource }: {
  field: DocumentFieldDefinition
  value: unknown
  fieldKey: string
  summaryFields: DocumentFieldDefinition[]
  fieldValues: Record<string, unknown>
  provenanceFields: Record<string, Ref>
  onFocusSource: (target: { page: number; bbox: Ref["bbox"]; quote: string }) => void
}) {
  return <div className="space-y-2">
    <div className="flex items-center gap-2 px-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{field.label}</span>
      <div className="h-px flex-1 bg-slate-100" />
    </div>
    {field.itemFields?.length
      ? <LineItemsEditor fieldKey={fieldKey} itemFields={field.itemFields} initialRows={Array.isArray(value) ? value as Array<Record<string, unknown>> : []} />
      : <textarea id={fieldKey} name={fieldKey} defaultValue={Array.isArray(value) ? JSON.stringify(value) : ""} placeholder="JSON array" className="min-h-24 w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 font-mono text-sm" />}
    {summaryFields.length > 0 && <div className="flex flex-wrap items-center justify-end gap-4 rounded-lg border border-slate-100 bg-slate-50/80 px-4 py-2.5">
      {summaryFields.map((summaryField) => <TotalField key={summaryField.key} field={summaryField} value={fieldValues[summaryField.key]} ref={provenanceFields[summaryField.key] ?? null} onFocusSource={onFocusSource} />)}
    </div>}
  </div>
}
