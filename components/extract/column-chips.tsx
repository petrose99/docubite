"use client"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { DocumentFieldDefinition, DocumentItemFieldDefinition } from "@/lib/document-templates"
import { Loader2, Plus, Sparkles, Table2, X } from "lucide-react"
import { useState } from "react"

const FIELD_TYPES = ["string", "number", "date", "boolean", "enum", "array"] as const
const ITEM_TYPES = ["string", "number", "date", "boolean"] as const
const TYPE_LABELS: Record<string, string> = { string: "Text", number: "Number", date: "Date", boolean: "Yes / No", enum: "Choice", array: "Table (rows)" }

export function keyFromLabel(label: string, taken: Set<string>) {
  const base = label.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^[^a-z]+/, "").replace(/_+$/, "").slice(0, 50) || "column"
  let key = base.length < 2 ? `${base}_col` : base
  for (let suffix = 2; taken.has(key); suffix++) key = `${base}_${suffix}`
  return key
}

function FieldEditor({ field, onSave }: { field: DocumentFieldDefinition; onSave: (next: DocumentFieldDefinition) => void }) {
  const [draft, setDraft] = useState<DocumentFieldDefinition>(field)
  const patch = (changes: Partial<DocumentFieldDefinition>) => {
    const next = { ...draft, ...changes }
    setDraft(next)
    onSave(next)
  }
  const patchItem = (index: number, changes: Partial<DocumentItemFieldDefinition>) => {
    const itemFields = (draft.itemFields || []).map((item, position) => (position === index ? { ...item, ...changes } : item))
    patch({ itemFields })
  }
  const [newSub, setNewSub] = useState("")
  const addSub = () => {
    const label = newSub.trim()
    if (!label) return
    const taken = new Set((draft.itemFields || []).map((item) => item.key))
    patch({ itemFields: [...(draft.itemFields || []), { key: keyFromLabel(label, taken), label, type: "string", instruction: "", required: false }] })
    setNewSub("")
  }

  const inputClass = "w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
  return <div className="space-y-2.5">
    <div>
      <label className="mb-1 block text-xs font-medium text-stone-500">Column name</label>
      <input className={inputClass} value={draft.label} onChange={(event) => patch({ label: event.target.value })} />
    </div>
    <div className="flex gap-2">
      <div className="flex-1">
        <label className="mb-1 block text-xs font-medium text-stone-500">Type</label>
        <select className={inputClass} value={draft.type} onChange={(event) => {
          const type = event.target.value as DocumentFieldDefinition["type"]
          patch({ type, options: type === "enum" ? draft.options || [] : undefined, itemFields: type === "array" ? draft.itemFields || [] : undefined })
        }}>
          {FIELD_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
        </select>
      </div>
      <div className="flex items-end pb-1.5">
        <label className="inline-flex items-center gap-1.5 text-sm text-stone-700"><input type="checkbox" className="accent-emerald-600" checked={draft.required} onChange={(event) => patch({ required: event.target.checked })} />Required</label>
      </div>
    </div>
    <div>
      <label className="mb-1 block text-xs font-medium text-stone-500">Extraction instruction</label>
      <textarea className={inputClass} rows={2} placeholder="Tell the AI exactly what to read, e.g. “Total including tax”" value={draft.instruction} onChange={(event) => patch({ instruction: event.target.value })} />
    </div>
    {draft.type === "enum" && <div>
      <label className="mb-1 block text-xs font-medium text-stone-500">Allowed values (comma-separated)</label>
      <input className={inputClass} placeholder="paid, unpaid, overdue" value={(draft.options || []).join(", ")} onChange={(event) => patch({ options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean) })} />
    </div>}
    {draft.type === "array" && <div className="rounded-md border border-stone-200 bg-stone-50 p-2">
      <p className="mb-1.5 text-xs font-medium text-stone-500">Table columns (one spreadsheet column each)</p>
      <div className="space-y-1.5">
        {(draft.itemFields || []).map((item, index) => <div key={item.key} className="flex items-center gap-1.5">
          <input className="min-w-0 flex-1 rounded border border-stone-300 px-2 py-1 text-xs" value={item.label} onChange={(event) => patchItem(index, { label: event.target.value })} />
          <select className="rounded border border-stone-300 px-1 py-1 text-xs" value={item.type} onChange={(event) => patchItem(index, { type: event.target.value as DocumentItemFieldDefinition["type"] })}>
            {ITEM_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
          </select>
          <button type="button" className="rounded p-0.5 text-stone-400 hover:text-red-600" onClick={() => patch({ itemFields: (draft.itemFields || []).filter((_, position) => position !== index) })}><X className="h-3.5 w-3.5" /></button>
        </div>)}
        <div className="flex items-center gap-1.5">
          <input className="min-w-0 flex-1 rounded border border-dashed border-stone-300 px-2 py-1 text-xs" placeholder="Add table column…" value={newSub} onChange={(event) => setNewSub(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSub() } }} />
          <button type="button" className="rounded p-0.5 text-stone-400 hover:text-emerald-600" onClick={addSub}><Plus className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </div>}
  </div>
}

/** The Columns section of the extraction panel: fields as removable chips (click to edit in
 * a popover), a type-your-own column input, and the AI helpers. */
export function ColumnChips({ fields, onChange, onAiSuggest, onAiColumn, aiBusy, aiReady }: {
  fields: DocumentFieldDefinition[]
  onChange: (fields: DocumentFieldDefinition[]) => void
  onAiSuggest: () => void
  onAiColumn: (description: string) => void
  aiBusy: boolean
  aiReady: boolean
}) {
  const [newColumn, setNewColumn] = useState("")
  const [aiColumnOpen, setAiColumnOpen] = useState(false)
  const [aiColumnText, setAiColumnText] = useState("")

  const addColumn = () => {
    const label = newColumn.trim()
    if (!label) return
    const taken = new Set(fields.map((field) => field.key))
    onChange([...fields, { key: keyFromLabel(label, taken), label, type: "string", instruction: "", required: false }])
    setNewColumn("")
  }

  return <div className="space-y-2.5">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50" disabled={!aiReady || aiBusy} title={aiReady ? "Let AI propose columns from your first file" : "Add a file first"} onClick={onAiSuggest}>
        {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}AI suggest columns
      </button>
      <Popover open={aiColumnOpen} onOpenChange={setAiColumnOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 px-2.5 py-1 text-xs font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-50" disabled={!aiReady || aiBusy} title={aiReady ? "Describe one column in plain English" : "Add a file first"}>
            <Sparkles className="h-3.5 w-3.5" />AI column
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-3">
          <label className="mb-1 block text-xs font-medium text-stone-500">Describe the column you want</label>
          <input className="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500" placeholder="e.g. total including tax" value={aiColumnText} autoFocus onChange={(event) => setAiColumnText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && aiColumnText.trim()) { event.preventDefault(); onAiColumn(aiColumnText.trim()); setAiColumnText(""); setAiColumnOpen(false) } }} />
          <button type="button" className="mt-2 w-full rounded-md bg-emerald-600 px-2 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50" disabled={!aiColumnText.trim()} onClick={() => { onAiColumn(aiColumnText.trim()); setAiColumnText(""); setAiColumnOpen(false) }}>Add with AI</button>
        </PopoverContent>
      </Popover>
    </div>

    <div className="flex flex-wrap gap-1.5">
      {fields.map((field, index) => {
        const isArray = field.type === "array"
        return <Popover key={field.key}>
          <PopoverTrigger asChild>
            <button type="button" className={`group inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors ${isArray ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" : "border-stone-300 bg-white text-stone-800 hover:bg-stone-100"}`} title={field.instruction || field.label}>
              {isArray && <Table2 className="h-3.5 w-3.5" />}
              {field.label}
              {field.required && <span className="text-red-500">*</span>}
              <span role="button" tabIndex={-1} aria-label={`Remove ${field.label}`} className="rounded-full p-0.5 text-stone-400 hover:bg-stone-300 hover:text-stone-700" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); onChange(fields.filter((_, position) => position !== index)) }}><X className="h-3 w-3" /></span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-3">
            <FieldEditor field={field} onSave={(next) => onChange(fields.map((current, position) => (position === index ? next : current)))} />
          </PopoverContent>
        </Popover>
      })}
    </div>

    <div className="flex items-center gap-2">
      <input className="min-w-0 flex-1 rounded-md border border-stone-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500" placeholder="Enter column name" value={newColumn} onChange={(event) => setNewColumn(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addColumn() } }} />
      <button type="button" className="shrink-0 rounded-md border border-stone-300 px-2.5 py-1.5 text-sm font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-50" disabled={!newColumn.trim()} onClick={addColumn}>+ Add column</button>
    </div>
  </div>
}
