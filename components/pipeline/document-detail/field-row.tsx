"use client"

import { LineItemsEditor } from "@/components/documents/line-items-editor"
import type { DocumentFieldDefinition } from "@/lib/document-templates"
import type { Ref } from "@/lib/provenance"
import { Crosshair, Pencil } from "lucide-react"

const LOW_CONFIDENCE = 0.6

export function FieldRow({ field, value, confidence, ref: provenanceRef, onFocusSource }: {
  field: DocumentFieldDefinition
  value: unknown
  confidence: number | null
  ref: Ref | null
  onFocusSource: (target: { page: number; bbox: Ref["bbox"]; quote: string }) => void
}) {
  const lowConfidence = typeof confidence === "number" && confidence < LOW_CONFIDENCE
  const isArray = field.type === "array"

  if (isArray) {
    return <div className="pt-2">
      {field.itemFields?.length
        ? <LineItemsEditor fieldKey={field.key} itemFields={field.itemFields} initialRows={Array.isArray(value) ? value as Array<Record<string, unknown>> : []} />
        : <textarea id={field.key} name={field.key} defaultValue={Array.isArray(value) ? JSON.stringify(value) : ""} placeholder="JSON array" className="min-h-24 w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 font-mono text-sm" />}
    </div>
  }

  return <div className={`group rounded-lg transition-colors ${lowConfidence ? "bg-amber-50/80 ring-1 ring-amber-200" : ""}`}>
    <div className="flex items-center gap-2 px-1 pb-1">
      <label htmlFor={field.key} className="text-xs font-medium text-slate-500">
        {field.label}{field.required && <span className="ml-0.5 text-red-400">*</span>}
      </label>
      {lowConfidence && <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-700">Low confidence</span>}
      {provenanceRef ? (
        <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 opacity-60 transition-opacity hover:bg-emerald-50 hover:opacity-100"
          onClick={() => onFocusSource({ page: provenanceRef.page, bbox: provenanceRef.bbox, quote: provenanceRef.quote })}
          title="Jump to where this was read in the source">
          <Crosshair className="h-3 w-3" />Source
        </button>
      ) : (
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-300" title="No source pin — entered by hand or unresolved">
          <Pencil className="h-2.5 w-2.5" />Manual
        </span>
      )}
    </div>
    {field.type === "boolean" ? (
      <label className="flex items-center gap-2 px-1 pb-1 text-sm text-slate-700"><input id={field.key} name={field.key} type="checkbox" className="h-4 w-4 rounded accent-emerald-600" value="true" defaultChecked={value === true} />Yes</label>
    ) : field.type === "enum" ? (
      <select id={field.key} name={field.key} defaultValue={typeof value === "string" ? value : ""} className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 transition-colors focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100">
        <option value="">Select a value</option>
        {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    ) : (
      <input id={field.key} name={field.key}
        type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
        step={field.type === "number" ? "any" : undefined}
        defaultValue={typeof value === "string" || typeof value === "number" ? String(value) : ""}
        className={`h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm transition-colors placeholder:text-slate-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 ${field.type === "number" ? "tabular-nums" : ""}`} />
    )}
  </div>
}
