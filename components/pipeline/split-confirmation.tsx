"use client"

import {
  confirmSplitAction,
  rejectSplitAction,
  type SplitSegment,
} from "@/app/(app)/workspaces/[workspaceId]/split-actions"
import { Check, Loader2, Scissors, X } from "lucide-react"
import { useCallback, useState, useTransition } from "react"

export function SplitConfirmation({ workspaceId, documentId, fileId, filename, segments, onComplete }: {
  workspaceId: string
  documentId: string
  fileId: string
  filename: string
  segments: SplitSegment[]
  onComplete: () => void
}) {
  const [editableSegments, setEditableSegments] = useState(
    segments.map((s, i) => ({
      ...s,
      filename: `${filename.replace(/\.[^.]+$/, "")}_part${i + 1}${filename.match(/\.[^.]+$/)?.[0] ?? ""}`,
    }))
  )
  const [confirming, startConfirm] = useTransition()
  const [rejecting, startReject] = useTransition()

  const updateFilename = useCallback((index: number, value: string) => {
    setEditableSegments((prev) => prev.map((s, i) => i === index ? { ...s, filename: value } : s))
  }, [])

  const confirm = useCallback(() => {
    startConfirm(async () => {
      await confirmSplitAction(workspaceId, documentId, fileId, editableSegments.map((s) => ({
        pageRange: s.pageRange,
        filename: s.filename,
      })))
      onComplete()
    })
  }, [workspaceId, documentId, fileId, editableSegments, onComplete])

  const reject = useCallback(() => {
    startReject(async () => {
      await rejectSplitAction(workspaceId, documentId)
      onComplete()
    })
  }, [workspaceId, documentId, onComplete])

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Scissors className="h-4 w-4 text-amber-600" />
        <h3 className="text-sm font-semibold text-amber-900">
          Split detected: {segments.length} documents in {filename}
        </h3>
      </div>

      <p className="mb-4 text-xs text-amber-700">
        We detected {segments.length} separate documents in this file. Review the proposed split below and confirm or reject.
      </p>

      <div className="mb-4 space-y-2">
        {editableSegments.map((seg, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2">
            <span className="shrink-0 text-xs font-medium text-amber-600">
              p.{seg.pageRange}
            </span>
            <input
              type="text"
              value={seg.filename}
              onChange={(e) => updateFilename(i, e.target.value)}
              className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-emerald-400"
            />
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
              seg.confidence >= 0.7 ? "bg-emerald-100 text-emerald-700" :
              seg.confidence >= 0.4 ? "bg-amber-100 text-amber-700" :
              "bg-slate-100 text-slate-500"
            }`}>
              {Math.round(seg.confidence * 100)}%
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={confirm}
          disabled={confirming || rejecting}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Confirm split
        </button>
        <button
          onClick={reject}
          disabled={confirming || rejecting}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {rejecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          Keep as one
        </button>
      </div>
    </div>
  )
}
