"use client"

import { deleteApprovalWorkflowAction, setApprovalWorkflowActiveAction } from "@/app/(app)/workspaces/[workspaceId]/approval-actions"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

export function ApprovalWorkflowRowControls({ workspaceId, workflowId, workflowName, active }: { workspaceId: string; workflowId: string; workflowName: string; active: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const toggle = async () => {
    setPending(true)
    try {
      const result = await setApprovalWorkflowActiveAction(workspaceId, workflowId, !active)
      if (!result.success) { toast.error(result.error || "Could not update the workflow"); return }
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false) }
  }

  const remove = async () => {
    setPending(true)
    try {
      const result = await deleteApprovalWorkflowAction(workspaceId, workflowId)
      if (!result.success) { toast.error(result.error || "Could not delete the workflow"); return }
      toast.success("Workflow deleted")
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false); setConfirmOpen(false) }
  }

  return <div className="flex items-center gap-2">
    <button type="button" disabled={pending} onClick={() => void toggle()}
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"}`}>
      {active ? "Active" : "Inactive"}
    </button>
    <button type="button" disabled={pending} onClick={() => setConfirmOpen(true)} className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50">Delete</button>
    <ConfirmDialog
      open={confirmOpen}
      destructive
      busy={pending}
      title="Delete this workflow?"
      description={`Tasks already using "${workflowName}" keep their progress but lose the workflow link — the FK is set-null, not blocked. This cannot be undone.`}
      confirmLabel={pending ? "Deleting…" : "Delete"}
      onConfirm={() => void remove()}
      onCancel={() => setConfirmOpen(false)} />
  </div>
}
