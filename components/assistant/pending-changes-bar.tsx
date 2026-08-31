"use client"

import { Check, Loader2, Undo2 } from "lucide-react"

/** The bar that appears over the grid the moment the assistant changes anything.
 *
 * Lido's arrangement, and the reason for it is that the writes land immediately: the user sees
 * the new column appear and needs a way to say "no" that does not depend on finding Ctrl+Z
 * before touching anything else. Nothing here blocks â€” the changes are already in the sheet and
 * already saving; this only decides whether they keep the green on them. */
export function PendingChangesBar({ count, busy, onUndo, onAccept }: {
  count: number
  /** The assistant is still working. Accepting mid-run would clear the highlights off changes
   * that are still arriving, so both buttons wait. */
  busy: boolean
  onUndo: () => void
  onAccept: () => void
}) {
  if (!count) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-slate-200 bg-white/95 py-2 pl-4 pr-2 shadow-lg backdrop-blur">
        <span className="flex items-center gap-1.5 text-sm text-slate-700">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
          <strong className="font-semibold">{count}</strong>
          {count === 1 ? "change" : "changes"}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={onUndo}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40">
          <Undo2 className="h-3.5 w-3.5" />Undo
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onAccept}
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-40">
          <Check className="h-3.5 w-3.5" />Accept
        </button>
      </div>
    </div>
  )
}
