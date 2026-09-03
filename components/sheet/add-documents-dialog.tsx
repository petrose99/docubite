"use client"

import {
  getPlacementRowsAction,
  listPlaceableDocumentsAction,
  markDocumentsPlacedAction,
  type PlaceableDocument,
} from "@/app/(app)/workspaces/[workspaceId]/sheet-placement-actions"
import { appendExtractionRows } from "@/components/sheet/extraction-bridge"
import type { FUniver } from "@univerjs/presets"
import { CheckCircle2, FileText, Loader2, Search, X } from "lucide-react"
import { useCallback, useEffect, useState, useTransition } from "react"

export function AddDocumentsDialog({ workspaceId, fileId, apiRef, onClose }: {
  workspaceId: string
  fileId: string
  apiRef: React.RefObject<FUniver | null>
  onClose: () => void
}) {
  const [docs, setDocs] = useState<PlaceableDocument[]>([])
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [placing, startPlacing] = useTransition()

  useEffect(() => {
    setLoading(true)
    listPlaceableDocumentsAction(workspaceId, fileId, { query: query || undefined })
      .then(setDocs)
      .finally(() => setLoading(false))
  }, [workspaceId, fileId, query])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    const unplaced = docs.filter((d) => !d.alreadyPlaced)
    setSelected(new Set(unplaced.map((d) => d.id)))
  }, [docs])

  const place = useCallback(() => {
    const api = apiRef.current
    if (!api || selected.size === 0) return

    const activeSheet = api.getActiveWorkbook()?.getActiveSheet()
    if (!activeSheet) return

    const univerSheetId = activeSheet.getSheetId()
    const lastRow = activeSheet.getLastRow()
    const existingHeaders: string[] = []
    if (lastRow >= 0) {
      const headerRange = activeSheet.getRange(0, 0, 1, activeSheet.getLastColumn() + 1)
      const values = headerRange.getValues()
      if (values?.[0]) {
        for (const cell of values[0]) {
          if (cell && typeof cell === "object" && "v" in (cell as Record<string, unknown>)) existingHeaders.push(String((cell as Record<string, unknown>).v))
          else if (cell != null) existingHeaders.push(String(cell))
        }
      }
    }

    const documentIds = Array.from(selected)

    startPlacing(async () => {
      const result = await getPlacementRowsAction(workspaceId, fileId, univerSheetId, documentIds, existingHeaders)
      if (result.rows.length > 0) {
        appendExtractionRows(api, {
          sheetId: result.sheetId,
          sheetName: activeSheet.getSheetName(),
          columns: result.columns,
          rows: result.rows,
          documentIds,
        }, { writeHeader: result.writeHeader })
      }
      await markDocumentsPlacedAction(workspaceId, fileId, univerSheetId, documentIds)
      onClose()
    })
  }, [apiRef, workspaceId, fileId, selected, onClose])

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
    <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-[#e6ebf1] bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between border-b px-5 py-4">
        <h2 className="text-lg font-bold text-slate-900">Add documents to sheet</h2>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
      </div>

      <div className="border-b px-5 py-3">
        <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search documents..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : docs.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-400">No documents to add.</p>
        ) : (
          <div className="divide-y">
            {docs.map((doc) => (
              <button
                key={doc.id}
                onClick={() => !doc.alreadyPlaced && toggle(doc.id)}
                disabled={doc.alreadyPlaced}
                className={`flex w-full items-center gap-3 px-5 py-3 text-left transition-colors ${doc.alreadyPlaced ? "opacity-50" : "hover:bg-slate-50"}`}
              >
                <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${selected.has(doc.id) ? "border-emerald-600 bg-emerald-600" : doc.alreadyPlaced ? "border-slate-200 bg-slate-100" : "border-slate-300"}`}>
                  {(selected.has(doc.id) || doc.alreadyPlaced) && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
                </div>
                <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800">{doc.filename}</div>
                  <div className="text-xs text-slate-400">
                    {doc.templateName ?? "No template"}
                    {doc.alreadyPlaced && " · Already in this sheet"}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t px-5 py-4">
        <button onClick={selectAll} className="text-sm font-medium text-emerald-700 hover:text-emerald-800">Select all</button>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
          <button onClick={place} disabled={selected.size === 0 || placing}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
            {placing && <Loader2 className="h-4 w-4 animate-spin" />}
            Add {selected.size > 0 ? `${selected.size} document${selected.size === 1 ? "" : "s"}` : "documents"}
          </button>
        </div>
      </div>
    </div>
  </div>
}
