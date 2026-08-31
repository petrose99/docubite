"use client"

import {
  addExpenseClaimItemsAction, decideExpenseClaimAction, deleteExpenseClaimAction,
  removeExpenseClaimItemAction, submitExpenseClaimAction,
} from "@/app/(app)/workspaces/[workspaceId]/expense-claim-actions"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

export type ExpenseClaimRowData = {
  id: string
  title: string | null
  status: string
  total: number | null
  currencyCode: string | null
  submitter: { id: string; name: string } | null
  items: { id: string; merchant: string; total: number | null }[]
  workflow: { name: string; currentStageIndex: number; stages: { stageIndex: number; name: string; requireOwner: boolean }[] } | null
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600",
  submitted: "bg-indigo-100 text-indigo-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-700",
}

export function ExpenseClaimRow({ workspaceId, claim, currentUserId, isOwner, canDecideCurrentStage, availableWorkflows, unclaimedReceipts }: {
  workspaceId: string
  claim: ExpenseClaimRowData
  currentUserId: string
  isOwner: boolean
  /** Whether the current user can decide this claim's current position: for a workflow claim,
   * whatever stage it's on; for a plain submitted claim, just "is this person an owner". Computed
   * server-side (app/.../expenses/page.tsx) via the same lib/approvals/engine.ts the server action
   * re-checks, so the client never has to re-derive the owner gate. */
  canDecideCurrentStage: boolean
  availableWorkflows: { id: string; name: string; stageCount: number }[]
  /** Every unclaimed receipt in the workspace, not just ones relevant to this claim — the same list
   * the "New claim" form above already offers. Only rendered as a picker while this row is a draft
   * someone can still edit. */
  unclaimedReceipts: { id: string; filename: string; merchant: string; total: number | null }[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [workflowChoice, setWorkflowChoice] = useState("")
  const [addChoice, setAddChoice] = useState("")

  const mine = claim.submitter?.id === currentUserId
  const canEdit = claim.status === "draft" && (mine || isOwner)

  const addReceipt = async () => {
    if (!addChoice) return
    setPending(true)
    try {
      const result = await addExpenseClaimItemsAction(workspaceId, claim.id, claim.submitter?.id ?? null, [addChoice])
      if (!result.success) { toast.error(result.error || "Could not add that receipt"); return }
      setAddChoice("")
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false) }
  }

  const removeItem = async (itemId: string) => {
    setPending(true)
    try {
      const result = await removeExpenseClaimItemAction(workspaceId, claim.id, claim.submitter?.id ?? null, itemId)
      if (!result.success) { toast.error(result.error || "Could not remove that receipt"); return }
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false) }
  }

  const submitClaim = async () => {
    setPending(true)
    try {
      const result = await submitExpenseClaimAction(workspaceId, claim.id, claim.submitter?.id ?? null, workflowChoice || null)
      if (!result.success) { toast.error(result.error || "Could not submit the claim"); return }
      toast.success("Claim submitted")
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false) }
  }

  const removeClaim = async () => {
    setPending(true)
    try {
      const result = await deleteExpenseClaimAction(workspaceId, claim.id, claim.submitter?.id ?? null)
      if (!result.success) { toast.error(result.error || "Could not delete the claim"); return }
      toast.success("Claim deleted")
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false); setConfirmOpen(false) }
  }

  const decide = async (decision: "approve" | "reject") => {
    setPending(true)
    try {
      const result = await decideExpenseClaimAction(workspaceId, claim.id, Boolean(claim.workflow), decision)
      if (!result.success) { toast.error(result.error || "Could not record that decision"); return }
      toast.success(decision === "approve" ? "Approved" : "Rejected")
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false) }
  }

  return <li className="rounded border p-3">
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-900">{claim.title || "Untitled claim"}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLES[claim.status] ?? "bg-slate-100 text-slate-600"}`}>{claim.status}</span>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          {claim.submitter?.name ?? "Unknown"} · {claim.items.length} receipt{claim.items.length === 1 ? "" : "s"}
          {claim.total !== null && <> · {claim.total.toFixed(2)}{claim.currencyCode ? ` ${claim.currencyCode}` : ""}</>}
        </p>
      </div>
    </div>

    <ul className="mt-2 flex flex-wrap gap-1.5 text-xs text-slate-500">
      {claim.items.map((item) => <li key={item.id} className="flex items-center gap-1 rounded-full border px-2 py-0.5">
        {item.merchant}{item.total !== null ? ` (${item.total.toFixed(2)})` : ""}
        {canEdit && claim.items.length > 1 && (
          <button type="button" disabled={pending} onClick={() => void removeItem(item.id)} aria-label={`Remove ${item.merchant}`}
            className="ml-0.5 text-slate-400 hover:text-red-600 disabled:opacity-50">×</button>
        )}
      </li>)}
    </ul>

    {canEdit && unclaimedReceipts.length > 0 && (
      <div className="mt-2 flex items-center gap-2">
        <select className="rounded-md border px-2 py-1 text-xs" value={addChoice} onChange={(event) => setAddChoice(event.target.value)} disabled={pending}>
          <option value="">Add a receipt…</option>
          {unclaimedReceipts.map((receipt) => <option key={receipt.id} value={receipt.id}>{receipt.merchant}{receipt.total !== null ? ` (${receipt.total.toFixed(2)})` : ""}</option>)}
        </select>
        <button type="button" disabled={pending || !addChoice} onClick={() => void addReceipt()} className="rounded-md border px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Add</button>
      </div>
    )}

    {claim.workflow && (
      <p className="mt-2 text-xs text-slate-600">
        {claim.workflow.name} — stage {claim.workflow.currentStageIndex + 1} of {claim.workflow.stages.length}: {claim.workflow.stages[claim.workflow.currentStageIndex]?.name}
        {claim.workflow.stages[claim.workflow.currentStageIndex]?.requireOwner ? " (owner only)" : ""}
      </p>
    )}

    <div className="mt-2 flex flex-wrap items-center gap-2">
      {canEdit && (
        <>
          {availableWorkflows.length > 0 && (
            <select className="rounded-md border px-2 py-1 text-xs" value={workflowChoice} onChange={(event) => setWorkflowChoice(event.target.value)} disabled={pending}>
              <option value="">No workflow — plain decision</option>
              {availableWorkflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name} ({workflow.stageCount} stage{workflow.stageCount === 1 ? "" : "s"})</option>)}
            </select>
          )}
          <button type="button" disabled={pending} onClick={() => void submitClaim()} className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Submit</button>
          <button type="button" disabled={pending} onClick={() => setConfirmOpen(true)} className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50">Delete</button>
        </>
      )}
      {claim.status === "submitted" && (
        canDecideCurrentStage ? (
          <>
            <button type="button" disabled={pending} onClick={() => void decide("approve")} className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Approve</button>
            <button type="button" disabled={pending} onClick={() => void decide("reject")} className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">Reject</button>
          </>
        ) : <span className="text-xs text-indigo-700">Only a workspace owner can decide this{claim.workflow ? " stage" : ""}.</span>
      )}
    </div>

    <ConfirmDialog
      open={confirmOpen}
      destructive
      busy={pending}
      title="Delete this claim?"
      description="Its receipts are unclaimed again and can be added to a new claim. This cannot be undone."
      confirmLabel={pending ? "Deleting…" : "Delete"}
      onConfirm={() => void removeClaim()}
      onCancel={() => setConfirmOpen(false)} />
  </li>
}
