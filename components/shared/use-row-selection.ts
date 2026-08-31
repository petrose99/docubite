import { useRef, useState } from "react"

/** Click-to-toggle, shift-click-for-range row selection — the same state machine the spreadsheet
 * grid's row gutter and the Files browser both used to hand-roll separately. Generic over any row
 * with an `id`, so the pipeline list and the Files browser can share one implementation. */
export function useRowSelection<T extends { id: string }>(rows: T[]) {
  const [marked, setMarked] = useState<Set<string>>(new Set())
  const anchor = useRef<number | null>(null)

  // Rows re-render from the server after every mutation; marks that pointed at rows which no
  // longer exist would otherwise keep inflating a "Delete (n)" count forever.
  const [syncedRows, setSyncedRows] = useState(rows)
  if (syncedRows !== rows) {
    setSyncedRows(rows)
    const live = new Set(rows.map((row) => row.id))
    setMarked((previous) => new Set([...previous].filter((id) => live.has(id))))
  }

  const markRow = (index: number, event: React.MouseEvent | React.KeyboardEvent) => {
    const row = rows[index]
    if (!row) return
    const start = anchor.current
    if ("shiftKey" in event && event.shiftKey && start !== null && start < rows.length) {
      event.preventDefault()
      window.getSelection()?.removeAllRanges()
      const [from, to] = start <= index ? [start, index] : [index, start]
      setMarked((previous) => {
        const next = new Set(previous)
        for (let cursor = from; cursor <= to; cursor++) next.add(rows[cursor].id)
        return next
      })
      return
    }
    anchor.current = index
    setMarked((previous) => {
      const next = new Set(previous)
      if (next.has(row.id)) next.delete(row.id)
      else next.add(row.id)
      return next
    })
  }

  const toggleAll = () => {
    setMarked((previous) => (previous.size === rows.length ? new Set() : new Set(rows.map((row) => row.id))))
    anchor.current = null
  }

  const clear = () => {
    setMarked(new Set())
    anchor.current = null
  }

  return { marked, markRow, toggleAll, clear, setMarked }
}
