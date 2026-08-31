"use client"

import {
  archiveDocumentsAction, bulkExportDocumentsAction, deletePipelineDocumentsAction,
  flagDocumentsAction, mergeDocumentsAction, moveDocumentsToStageAction,
} from "@/app/(app)/workspaces/[workspaceId]/pipeline-actions"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import type { PipelineStage } from "@/lib/documents/stages"
import { Archive, CheckCircle2, Combine, Download, Flag, Loader2, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

/** The N-selected action bar. Which actions make sense depends on the stage being viewed: you
 * can't "Move to Ready" from Archive (restore is the equivalent there), and Merge only ever
 * applies to exactly two rows. */
export function BulkActionBar({ workspaceId, stage, selectedIds, onDone }: { workspaceId: string; stage: PipelineStage; selectedIds: string[]; onDone: () => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const run = async (label: string, action: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(true)
    try {
      const result = await action()
      if (!result.success) { toast.error(result.error || `${label} failed`); return }
      toast.success(label)
      onDone()
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally {
      setBusy(false)
    }
  }

  const exportSelected = async () => {
    setBusy(true)
    try {
      const result = await bulkExportDocumentsAction(workspaceId, selectedIds)
      if (!result.success || !result.data) { toast.error(result.error || "Export failed"); return }
      const blob = new Blob([result.data.csv], { type: "text/csv" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "documents.csv"
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error("Could not reach the server")
    } finally {
      setBusy(false)
    }
  }

  return <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50 px-6 py-2.5 text-sm">
    <span className="font-medium text-slate-700">{selectedIds.length} selected</span>

    {stage !== "ready" && stage !== "archive" && <button type="button" disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      onClick={() => run("Moved to Ready", () => moveDocumentsToStageAction(workspaceId, selectedIds, "ready"))}>
      <CheckCircle2 className="h-3.5 w-3.5" />Move to Ready
    </button>}

    {stage !== "archive" && <button type="button" disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      onClick={() => run("Archived", () => archiveDocumentsAction(workspaceId, selectedIds, true))}>
      <Archive className="h-3.5 w-3.5" />Archive
    </button>}

    {stage === "archive" && <button type="button" disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      onClick={() => run("Restored", () => archiveDocumentsAction(workspaceId, selectedIds, false))}>
      <Archive className="h-3.5 w-3.5" />Restore
    </button>}

    <button type="button" disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      onClick={() => run("Flagged", () => flagDocumentsAction(workspaceId, selectedIds, true))}>
      <Flag className="h-3.5 w-3.5" />Flag
    </button>

    {selectedIds.length === 2 && <button type="button" disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      onClick={() => run("Merged", () => mergeDocumentsAction(workspaceId, selectedIds))}>
      <Combine className="h-3.5 w-3.5" />Merge
    </button>}

    <button type="button" disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50" onClick={() => void exportSelected()}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}Export
    </button>

    <button type="button" disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-2.5 py-1 font-medium text-red-600 hover:bg-red-50 disabled:opacity-50" onClick={() => setConfirmingDelete(true)}>
      <Trash2 className="h-3.5 w-3.5" />Delete
    </button>

    <button type="button" className="ml-1 rounded-md px-2 py-1 font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800" onClick={onDone}>Clear</button>

    <ConfirmDialog
      open={confirmingDelete}
      destructive
      busy={busy}
      title={`Delete ${selectedIds.length} document${selectedIds.length === 1 ? "" : "s"}?`}
      description="This removes their extracted rows and the uploaded sources behind them. This cannot be undone."
      confirmLabel={busy ? "Deleting…" : "Delete"}
      onConfirm={() => { setConfirmingDelete(false); void run("Deleted", () => deletePipelineDocumentsAction(workspaceId, selectedIds)) }}
      onCancel={() => setConfirmingDelete(false)} />
  </div>
}
