"use client"

import type { FUniver } from "@univerjs/presets"
import type { FWorksheet } from "@univerjs/preset-sheets-core"
import { Files, X } from "lucide-react"
import { useEffect, useState, type RefObject } from "react"

/** One document's block of rows in the current sheet, plus the row spans of every *other*
 * document — precomputed at scan time so filtering never has to re-scan the grid. */
export type DocumentGroup = {
  /** Null for the "Other rows" bucket: rows with no `custom.documentId` on any cell. */
  documentId: string | null
  filename: string
  count: number
  firstRow: number
  /** [startRow, numRows] pairs, one per other group, ready for `hideRows`. */
  hideRanges: [number, number][]
}

export type ActiveFilter = {
  sheetId: string
  documentId: string | null
  filename: string
  hiddenRanges: [number, number][]
}

/** Groups the active sheet's rows by the document that produced them, scanning left to right on
 * each row so a document whose first column is blank for some row is not missed. Rows carrying no
 * `custom.documentId` anywhere bucket into "Other rows" rather than being dropped, so the panel's
 * counts always sum to the sheet's row count. */
function scanDocuments(sheet: FWorksheet): DocumentGroup[] {
  const lastRow = sheet.getLastRow()
  if (lastRow < 1) return []
  const lastCol = sheet.getLastColumn()
  const grid = sheet.getRange(1, 0, lastRow, lastCol + 1).getCellDatas()

  type Draft = { documentId: string | null; filename: string; firstRow: number; rowIndexes: number[] }
  const order: string[] = []
  const drafts = new Map<string, Draft>()

  grid.forEach((rowCells, offset) => {
    const rowIndex = offset + 1
    let custom: { documentId?: string; filename?: string } | undefined
    for (const cell of rowCells) {
      const candidate = cell?.custom as { documentId?: string; filename?: string } | undefined
      if (candidate?.documentId) { custom = candidate; break }
    }
    const documentId = custom?.documentId ?? null
    const key = documentId ?? "__other__"
    let draft = drafts.get(key)
    if (!draft) {
      draft = { documentId, filename: documentId ? custom?.filename || `Document ${documentId.slice(0, 8)}` : "Other rows", firstRow: rowIndex, rowIndexes: [] }
      drafts.set(key, draft)
      order.push(key)
    }
    draft.rowIndexes.push(rowIndex)
  })

  const groups = order.map((key) => drafts.get(key)!).sort((a, b) => a.firstRow - b.firstRow)

  return groups.map((group) => ({
    documentId: group.documentId,
    filename: group.filename,
    count: group.rowIndexes.length,
    firstRow: group.firstRow,
    hideRanges: groups
      .filter((other) => other !== group)
      .map((other): [number, number] => {
        const min = Math.min(...other.rowIndexes)
        const max = Math.max(...other.rowIndexes)
        return [min, max - min + 1]
      }),
  }))
}

/** The documents contributing to the current sheet, sorted top-to-bottom as they appear in the
 * grid: click one to filter the live, editable grid down to just its rows.
 *
 * Deliberately not a data-fetching panel — the document/row mapping already lives on every cell
 * Univer ever writes (`custom.documentId`, lib/sheet-seed.ts), so this scans the live grid rather
 * than asking the server for something it already has. */
export function DocumentListPanel({ apiRef, activeFilter, onFilter, onShowAll, onClose }: {
  apiRef: RefObject<FUniver | null>
  activeFilter: ActiveFilter | null
  onFilter: (doc: DocumentGroup) => void
  onShowAll: () => void
  onClose: () => void
}) {
  const [groups, setGroups] = useState<DocumentGroup[]>([])

  useEffect(() => {
    const api = apiRef.current
    if (!api) return

    const rescan = () => {
      const sheet = api.getActiveWorkbook()?.getActiveSheet()
      setGroups(sheet ? scanDocuments(sheet) : [])
    }
    rescan()

    const disposable = api.addEvent(api.Event.ActiveSheetChanged, rescan)
    return () => disposable.dispose()
  }, [apiRef])

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 rounded-lg border border-stone-200 bg-white shadow-xl">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Files className="h-4 w-4 text-emerald-700" />
        <span className="text-sm font-semibold text-stone-800">Documents</span>
        <button type="button" aria-label="Close Documents" className="ml-auto rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-80 space-y-0.5 overflow-y-auto p-2">
        {groups.length === 0 && <p className="px-2 py-3 text-sm text-stone-500">No rows in this sheet yet.</p>}
        {groups.map((group) => {
          const active = activeFilter?.documentId === group.documentId
          return (
            <button
              key={group.documentId ?? "__other__"}
              type="button"
              onClick={() => (active ? onShowAll() : onFilter(group))}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${active ? "bg-emerald-50 text-emerald-900" : "text-stone-700 hover:bg-stone-50"}`}>
              <span className="truncate">{group.filename}</span>
              <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">{group.count} row{group.count === 1 ? "" : "s"}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
