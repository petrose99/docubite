"use client"

import { buildFormulaAction } from "@/app/(app)/workspaces/[workspaceId]/sheet-actions"
import { cellRef } from "@/components/assistant/pending-changes"
import type { FUniver } from "@univerjs/presets"
import { Loader2, Sparkles, X } from "lucide-react"
import { useEffect, useRef, useState, type RefObject } from "react"

/** Sample values are one row: enough for the model to tell a date column from a total, without
 * sending the sheet's contents anywhere. */
const SAMPLE_ROW = 1

/** Lido's AI formula builder: describe the calculation, look at the formula, then put it in.
 *
 * The pause between generating and inserting is the whole point. The assistant is for "do this
 * for me"; this is for "what is the formula for this?", where the user wants to read it — and
 * often to edit it — before it lands in their sheet. */
export function FormulaBuilder({ workspaceId, apiRef, onClose }: {
  workspaceId: string
  apiRef: RefObject<FUniver | null>
  onClose: () => void
}) {
  const [request, setRequest] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ formula: string; explanation: string } | null>(null)
  const [target, setTarget] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // The cell the formula is for is whichever one was selected when this opened; it is captured
  // once so that clicking around inside the panel cannot move the target under the user.
  useEffect(() => {
    const sheet = apiRef.current?.getActiveWorkbook()?.getActiveSheet()
    const selection = sheet?.getSelection()?.getActiveRange()
    setTarget(selection ? cellRef(selection.getRow(), selection.getColumn()) : "A1")
    inputRef.current?.focus()
  }, [apiRef])

  const generate = async () => {
    const sheet = apiRef.current?.getActiveWorkbook()?.getActiveSheet()
    if (!sheet || busy) return
    setBusy(true)
    setError(null)
    setResult(null)

    const width = Math.max(sheet.getLastColumn() + 1, 1)
    const headers = (sheet.getRange(0, 0, 1, width).getValues()[0] ?? []).map((value) => String(value ?? ""))
    const sampleRow = sheet.getLastRow() >= SAMPLE_ROW
      ? (sheet.getRange(SAMPLE_ROW, 0, 1, width).getValues()[0] ?? []).map((value) => (value ?? null) as string | number | boolean | null)
      : []

    const response = await buildFormulaAction(workspaceId, request, { headers, sampleRow, targetRef: target }).catch(() => null)
    setBusy(false)
    if (!response?.success || !response.data) {
      setError(response?.error ?? "Could not reach the model")
      return
    }
    setResult(response.data)
  }

  /** Straight into the cell, as a formula. Not through the assistant's pending-changes bar: the
   * user has already read this one and pressed Insert, so Univer's own undo is the right and
   * only safety net. */
  const insert = () => {
    const sheet = apiRef.current?.getActiveWorkbook()?.getActiveSheet()
    if (!sheet || !result) return
    sheet.getRange(target).setValue({ f: result.formula, v: null, p: null, si: null })
    onClose()
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 rounded-lg border border-stone-200 bg-white shadow-xl">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Sparkles className="h-4 w-4 text-emerald-700" />
        <span className="text-sm font-semibold text-stone-800">AI Formula</span>
        <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-xs text-stone-500">{target}</span>
        <button type="button" aria-label="Close AI Formula" className="ml-auto rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2.5 p-3">
        <textarea
          ref={inputRef}
          rows={2}
          value={request}
          placeholder="Total the amounts where the supplier is Acme…"
          className="w-full resize-none rounded-md border border-stone-200 px-2.5 py-1.5 text-sm focus:border-emerald-400 focus:outline-none"
          onChange={(event) => setRequest(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void generate() }
          }} />

        {error && <p className="rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-700">{error}</p>}

        {result && (
          <div className="space-y-1.5 rounded-md border border-emerald-200 bg-emerald-50 p-2.5">
            <code className="block break-all font-mono text-xs text-emerald-900">{result.formula}</code>
            {result.explanation && <p className="text-xs text-emerald-800">{result.explanation}</p>}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy || !request.trim()}
            onClick={() => void generate()}
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-2.5 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-40">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{result ? "Try again" : "Generate"}
          </button>
          <button
            type="button"
            disabled={!result}
            onClick={insert}
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-40">
            Insert
          </button>
        </div>
      </div>
    </div>
  )
}
