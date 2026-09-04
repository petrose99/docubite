"use client"

import type { DocumentItemFieldDefinition } from "@/lib/document-templates"
import type { Ref } from "@/lib/provenance"
import { Crosshair, Plus, Trash2 } from "lucide-react"
import { useState } from "react"

type Row = { id: number; values: Record<string, unknown> }

const cellInputClass = "w-full min-w-0 rounded-sm border-0 bg-transparent px-2 py-1.5 text-sm text-slate-800 outline-none focus:bg-emerald-50 focus:ring-1 focus:ring-inset focus:ring-emerald-500"

const hasValue = (value: unknown) => value !== undefined && value !== null && value !== ""

/** Line items as an actual grid — one row per item, one column per field, cells that edit in
 * place — rather than a stack of bordered cards repeating every label. The header row plus
 * light cell dividers are what make it read as a small spreadsheet instead of a form.
 *
 * Columns are the template's real schema (itemFields), never invented ones — but a column the
 * model never actually extracted anything into, across every row of THIS document, is dropped
 * rather than shown as a wall of empty cells (a required column is the one exception: it stays
 * visible even empty, since a missing required value is itself worth seeing). On a document with
 * no line items yet (a fresh row for someone to fill in by hand), nothing has "not been
 * extracted" yet, so every column shows. */
export function LineItemsEditor({ fieldKey, itemFields, initialRows, provenanceItems, onFocusSource }: {
  fieldKey: string
  itemFields: DocumentItemFieldDefinition[]
  initialRows: Array<Record<string, unknown>>
  provenanceItems?: (Ref | null)[]
  onFocusSource?: (target: { page: number; bbox: Ref["bbox"]; quote: string }) => void
}) {
  const [rows, setRows] = useState<Row[]>(() => {
    const seed = initialRows.length ? initialRows : [{}]
    return seed.map((values, index) => ({ id: index, values }))
  })
  const columns = initialRows.length
    ? itemFields.filter((item) => item.required || initialRows.some((row) => hasValue(row[item.key])))
    : itemFields

  const addRow = () => setRows((current) => [...current, { id: (current.at(-1)?.id ?? -1) + 1, values: {} }])
  const removeRow = (id: number) => setRows((current) => (current.length > 1 ? current.filter((row) => row.id !== id) : current))

  return <div className="overflow-hidden rounded-lg border border-slate-200">
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50">
            {columns.map((item) => <th key={item.key} scope="col" className={`border-b border-slate-200 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 ${item.type === "number" ? "text-right" : "text-left"}`}>
              {item.label}{item.required ? " *" : ""}
            </th>)}
            <th scope="col" className="w-8 border-b border-slate-200" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const rowRef = provenanceItems?.[index] ?? null
            return <tr key={row.id} className="group even:bg-slate-50/50 hover:bg-emerald-50/40">
            {columns.map((item) => {
              const inputId = `${fieldKey}-${row.id}-${item.key}`
              const name = `${fieldKey}[${index}][${item.key}]`
              const raw = row.values[item.key]
              return <td key={item.key} className="border-b border-slate-100 p-0">
                {item.type === "boolean" ? (
                  <label className="flex h-full items-center justify-center gap-1.5 px-2 py-1.5 text-xs text-slate-600">
                    <input id={inputId} name={name} type="checkbox" className="h-3.5 w-3.5 accent-emerald-600" value="true" defaultChecked={raw === true} />
                  </label>
                ) : item.type === "enum" ? (
                  <select id={inputId} name={name} defaultValue={typeof raw === "string" ? raw : ""} className={`${cellInputClass} appearance-none`}>
                    <option value="">—</option>
                    {item.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : (
                  <input id={inputId} name={name} type={item.type === "number" ? "number" : item.type === "date" ? "date" : "text"} step={item.type === "number" ? "any" : undefined}
                    className={`${cellInputClass} ${item.type === "number" ? "text-right tabular-nums" : ""}`}
                    defaultValue={typeof raw === "string" || typeof raw === "number" ? String(raw) : ""} />
                )}
              </td>
            })}
            <td className="border-b border-slate-100 px-1 text-center">
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                {rowRef && onFocusSource && (
                  <button type="button" aria-label="View source" title="View source in document"
                    className="rounded p-1 text-emerald-500 hover:bg-emerald-50 hover:text-emerald-700"
                    onClick={() => onFocusSource({ page: rowRef.page, bbox: rowRef.bbox, quote: rowRef.quote })}>
                    <Crosshair className="h-3.5 w-3.5" />
                  </button>
                )}
                <button type="button" aria-label="Remove row" title="Remove row" disabled={rows.length <= 1}
                  className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600 disabled:pointer-events-none disabled:opacity-0"
                  onClick={() => removeRow(row.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </td>
          </tr>})}
        </tbody>
      </table>
    </div>
    <button type="button" onClick={addRow}
      className="flex w-full items-center gap-1.5 border-t border-slate-200 bg-slate-50/50 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-emerald-50 hover:text-emerald-700">
      <Plus className="h-3.5 w-3.5" />Add row
    </button>
  </div>
}
