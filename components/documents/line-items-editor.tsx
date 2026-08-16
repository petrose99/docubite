"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { DocumentItemFieldDefinition } from "@/lib/document-templates"
import { Plus, Trash2 } from "lucide-react"
import { useState } from "react"

type Row = { id: number; values: Record<string, unknown> }

export function LineItemsEditor({ fieldKey, itemFields, initialRows }: { fieldKey: string; itemFields: DocumentItemFieldDefinition[]; initialRows: Array<Record<string, unknown>> }) {
  const [rows, setRows] = useState<Row[]>(() => {
    const seed = initialRows.length ? initialRows : [{}]
    return seed.map((values, index) => ({ id: index, values }))
  })

  return <div className="space-y-3">
    {rows.map((row, index) => <div key={row.id} className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
      {itemFields.map((item) => {
        const inputId = `${fieldKey}-${row.id}-${item.key}`
        const name = `${fieldKey}[${index}][${item.key}]`
        return <div key={item.key} className="space-y-1">
          <Label htmlFor={inputId}>{item.label}{item.required ? " *" : ""}</Label>
          {item.type === "boolean" ? (
            <label className="flex items-center gap-2 text-sm"><input id={inputId} name={name} type="checkbox" value="true" defaultChecked={row.values[item.key] === true} />Yes</label>
          ) : item.type === "enum" ? (
            <select id={inputId} name={name} defaultValue={typeof row.values[item.key] === "string" ? String(row.values[item.key]) : ""} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              <option value="">Select a value</option>
              {item.options?.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          ) : (
            <Input id={inputId} name={name} type={item.type === "number" ? "number" : item.type === "date" ? "date" : "text"} step={item.type === "number" ? "any" : undefined} defaultValue={typeof row.values[item.key] === "string" || typeof row.values[item.key] === "number" ? String(row.values[item.key]) : ""} />
          )}
        </div>
      })}
      <div className="sm:col-span-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setRows((current) => current.filter((currentRow) => currentRow.id !== row.id))}>
          <Trash2 />Remove row
        </Button>
      </div>
    </div>)}
    <Button type="button" variant="outline" size="sm" onClick={() => setRows((current) => [...current, { id: (current.at(-1)?.id ?? -1) + 1, values: {} }])}>
      <Plus />Add row
    </Button>
  </div>
}
