"use client"

import { aggregateValuesAction } from "@/app/(app)/workspaces/[workspaceId]/data-actions"
import { DataChatPanel } from "@/components/data/data-chat-panel"
import type { DataFilters } from "@/models/document-values"
import { ArrowUpDown, Download, FileText, Loader2, Search, Sparkles } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

export type DataColumn = { key: string; label: string; isArray: boolean }
export type DataNumberField = { key: string; label: string }

export type DataRow = {
  id: string
  filename: string
  status: string
  receivedAt: string
  docType: string
  entity: string
  fileName: string
  worksheetName: string | null
  data: Record<string, unknown>
}

export type DataFilterOptions = {
  templates: Array<{ id: string; name: string; fileName: string }>
  files: Array<{ id: string; name: string }>
  docTypes: string[]
}

const STATUS_STYLES: Record<string, string> = {
  reviewed: "bg-emerald-100 text-emerald-700",
  ready_for_review: "bg-sky-100 text-sky-700",
  needs_review: "bg-amber-100 text-amber-700",
  queued: "bg-stone-100 text-stone-600",
  processing: "bg-stone-100 text-stone-600",
  received: "bg-stone-100 text-stone-600",
  failed: "bg-red-100 text-red-700",
}

const statusLabel = (status: string) => status.replaceAll("_", " ")

const relativeDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })

function cellText(value: unknown, isArray: boolean): string {
  if (value === null || value === undefined || value === "") return ""
  if (isArray || Array.isArray(value)) {
    const items = Array.isArray(value) ? value : []
    return `${items.length} item${items.length === 1 ? "" : "s"}`
  }
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

export function DataBrowser({ workspaceId, filters, rows, options, columns, numberFields, aiEnabled }: {
  workspaceId: string
  filters: { q: string; template: string; file: string; doctype: string; status: string; from: string; to: string; sort: string; dir: "asc" | "desc" }
  rows: DataRow[]
  options: DataFilterOptions
  /** Dynamic columns for the selected template (empty when no template filter is active). */
  columns: DataColumn[]
  /** Top-level number fields of the selected template, for the aggregates strip. */
  numberFields: DataNumberField[]
  aiEnabled: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const base = `/workspaces/${workspaceId}/data`

  const [searchValue, setSearchValue] = useState(filters.q)
  const [assistantOpen, setAssistantOpen] = useState(false)

  const [syncedSearch, setSyncedSearch] = useState(filters.q)
  if (syncedSearch !== filters.q) {
    setSyncedSearch(filters.q)
    setSearchValue(filters.q)
  }

  const withParams = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(changes)) { if (value === null || value === "") params.delete(key); else params.set(key, value) }
    const query = params.toString()
    return query ? `${base}?${query}` : base
  }

  // URL-driven, debounced search — same shape as the Files browser.
  useEffect(() => {
    if (searchValue === filters.q) return
    const timer = setTimeout(() => router.push(withParams({ q: searchValue || null })), 300)
    return () => clearTimeout(timer)
  }, [searchValue]) // eslint-disable-line react-hooks/exhaustive-deps

  const setFilter = (key: string, value: string | null) => router.push(withParams({ [key]: value }))

  const sortLink = (field: string) => withParams({ sort: field, dir: filters.sort === field && filters.dir === "asc" ? "desc" : "asc" })
  const sortArrow = (field: string) => (filters.sort === field ? <ArrowUpDown className={`h-3 w-3 ${filters.dir === "asc" ? "" : "rotate-180"}`} /> : <ArrowUpDown className="h-3 w-3 opacity-25" />)

  const activeFilters: DataFilters = {
    query: filters.q || undefined,
    templateId: filters.template || undefined,
    fileId: filters.file || undefined,
    docType: filters.doctype || undefined,
    status: filters.status || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
  }

  const exportHref = `${base}/export?${searchParams.toString()}`

  const selectClass = "rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
  const inputClass = "rounded-md border border-stone-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"

  const metaColSpan = 6 + columns.length

  return <div className="flex min-h-0 flex-1">
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 py-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-72 max-w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input className={`${inputClass} w-full pl-8`} placeholder="Search extracted values and text" value={searchValue} onChange={(event) => setSearchValue(event.target.value)} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <a href={exportHref} className="inline-flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50">
            <Download className="h-4 w-4" />Export CSV
          </a>
          <button type="button" onClick={() => setAssistantOpen((value) => !value)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold ${assistantOpen ? "bg-emerald-800 text-white" : "bg-emerald-700 text-white hover:bg-emerald-800"}`}>
            <Sparkles className="h-4 w-4" />AI assistant
          </button>
        </div>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <select className={selectClass} value={filters.template} onChange={(event) => setFilter("template", event.target.value || null)}>
          <option value="">All worksheets</option>
          {options.templates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.fileName}</option>)}
        </select>
        <select className={selectClass} value={filters.file} onChange={(event) => setFilter("file", event.target.value || null)}>
          <option value="">All files</option>
          {options.files.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
        </select>
        {options.docTypes.length > 0 && <select className={selectClass} value={filters.doctype} onChange={(event) => setFilter("doctype", event.target.value || null)}>
          <option value="">All types</option>
          {options.docTypes.map((type) => <option key={type} value={type}>{type}</option>)}
        </select>}
        <select className={selectClass} value={filters.status} onChange={(event) => setFilter("status", event.target.value || null)}>
          <option value="">Any status</option>
          <option value="reviewed">Reviewed</option>
          <option value="ready_for_review">Ready for review</option>
          <option value="needs_review">Needs review</option>
          <option value="queued">Queued</option>
          <option value="failed">Failed</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-stone-500">From
          <input type="date" className={inputClass} value={filters.from} onChange={(event) => setFilter("from", event.target.value || null)} />
        </label>
        <label className="flex items-center gap-1 text-xs text-stone-500">To
          <input type="date" className={inputClass} value={filters.to} onChange={(event) => setFilter("to", event.target.value || null)} />
        </label>
      </div>

      {/* Aggregates strip */}
      <AggregatesStrip workspaceId={workspaceId} count={rows.length} numberFields={numberFields} filters={activeFilters} />

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-stone-50 text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
            <tr>
              <th className="border-b px-3 py-2"><Link href={sortLink("filename")} className="inline-flex items-center gap-1 hover:text-stone-800">Document {sortArrow("filename")}</Link></th>
              <th className="border-b px-3 py-2">File / Worksheet</th>
              <th className="border-b px-3 py-2">Type</th>
              <th className="border-b px-3 py-2">Entity</th>
              <th className="border-b px-3 py-2"><Link href={sortLink("receivedAt")} className="inline-flex items-center gap-1 hover:text-stone-800">Received {sortArrow("receivedAt")}</Link></th>
              <th className="border-b px-3 py-2"><Link href={sortLink("status")} className="inline-flex items-center gap-1 hover:text-stone-800">Status {sortArrow("status")}</Link></th>
              {columns.map((column) => <th key={column.key} className="border-b px-3 py-2">{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => <tr key={row.id} className="cursor-pointer hover:bg-stone-50" onClick={() => router.push(`/workspaces/${workspaceId}/documents/${row.id}`)}>
              <td className="border-b px-3 py-2">
                <span className="inline-flex items-center gap-2 font-medium text-stone-800">
                  <FileText className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span className="max-w-[16rem] truncate" title={row.filename}>{row.filename}</span>
                </span>
              </td>
              <td className="border-b px-3 py-2 text-stone-500">
                <span className="truncate">{row.fileName}{row.worksheetName ? ` · ${row.worksheetName}` : ""}</span>
              </td>
              <td className="border-b px-3 py-2 text-stone-600">{row.docType || "—"}</td>
              <td className="border-b px-3 py-2 text-stone-600">{row.entity || "—"}</td>
              <td className="border-b px-3 py-2 text-stone-500"><time dateTime={row.receivedAt}>{relativeDate(row.receivedAt)}</time></td>
              <td className="border-b px-3 py-2">
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status] ?? "bg-stone-100 text-stone-600"}`}>{statusLabel(row.status)}</span>
              </td>
              {columns.map((column) => <td key={column.key} className="border-b px-3 py-2 text-stone-600">
                <span className="max-w-[14rem] truncate" title={cellText(row.data[column.key], column.isArray)}>{cellText(row.data[column.key], column.isArray) || "—"}</span>
              </td>)}
            </tr>)}
            {rows.length === 0 && <tr><td colSpan={metaColSpan} className="px-4 py-16 text-center text-sm text-stone-400">
              No documents match these filters.
            </td></tr>}
            {rows.length >= 100 && <tr><td colSpan={metaColSpan} className="px-4 py-3 text-center text-xs text-stone-400">
              Showing the first 100 documents. Narrow the filters or export to CSV for the full set.
            </td></tr>}
          </tbody>
        </table>
      </div>
    </div>

    {assistantOpen && <DataChatPanel workspaceId={workspaceId} aiEnabled={aiEnabled} onClose={() => setAssistantOpen(false)} />}
  </div>
}

function AggregatesStrip({ workspaceId, count, numberFields, filters }: {
  workspaceId: string
  count: number
  numberFields: DataNumberField[]
  filters: DataFilters
}) {
  const [fieldKey, setFieldKey] = useState(numberFields[0]?.key ?? "")
  const [result, setResult] = useState<{ op: string; value: number | null } | null>(null)
  const [busy, setBusy] = useState(false)

  // Reset the picked field when the available number fields change (template switch).
  const [syncedFields, setSyncedFields] = useState(numberFields)
  if (syncedFields !== numberFields) {
    setSyncedFields(numberFields)
    setFieldKey(numberFields[0]?.key ?? "")
    setResult(null)
  }

  const run = async (op: "sum" | "avg") => {
    if (!fieldKey) return
    setBusy(true)
    setResult(null)
    try {
      const response = await aggregateValuesAction(workspaceId, { fieldKey, op, documentFilters: filters })
      if (!response.success || !response.data) { toast.error(response.error || "Could not calculate"); return }
      setResult({ op, value: response.data.value })
    } catch { toast.error("Could not reach the server") } finally { setBusy(false) }
  }

  const format = (value: number | null) => (value === null ? "—" : value.toLocaleString(undefined, { maximumFractionDigits: 2 }))

  return <div className="flex flex-wrap items-center gap-2 text-sm">
    <span className="rounded-full bg-stone-100 px-3 py-1 font-medium text-stone-700">{count} document{count === 1 ? "" : "s"}</span>
    {numberFields.length > 0 && <>
      <select className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm" value={fieldKey} onChange={(event) => { setFieldKey(event.target.value); setResult(null) }}>
        {numberFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
      </select>
      <button type="button" disabled={busy} className="rounded-md border bg-white px-2.5 py-1 font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50" onClick={() => void run("sum")}>Sum</button>
      <button type="button" disabled={busy} className="rounded-md border bg-white px-2.5 py-1 font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-50" onClick={() => void run("avg")}>Avg</button>
      {busy && <Loader2 className="h-4 w-4 animate-spin text-stone-400" />}
      {result && <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-800">{result.op === "sum" ? "Sum" : "Avg"}: {format(result.value)}</span>}
    </>}
  </div>
}
