"use client"

import { bulkUpdateReviewTaskStatusAction, decideReviewTaskStageAction, updateReviewTaskStatusAction } from "@/app/(app)/workspaces/[workspaceId]/review-actions"
import { createAutomationRuleAction, setDocumentCodingAction } from "@/app/(app)/workspaces/[workspaceId]/automation-actions"
import { decideExpenseClaimAction } from "@/app/(app)/workspaces/[workspaceId]/expense-claim-actions"
import { pushDocumentToAccountingAction } from "@/app/(app)/workspaces/[workspaceId]/integration-push-actions"
import type { FinanceProposalResult } from "@/lib/finance/actions"
import { useRouter } from "next/navigation"
import { CircleCheck, Loader2, X } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

const ERROR_MESSAGES: Record<string, string> = {
  review_queue_not_enabled: "The review queue isn't enabled for this workspace.",
  supplier_rules_not_enabled: "Supplier rules aren't enabled for this workspace.",
  accounting_push_not_enabled: "Accounting push isn't enabled for this workspace.",
  no_matching_review_tasks: "Couldn't find those review tasks.",
  review_task_not_found: "That review task no longer exists.",
  document_not_found: "That document no longer exists.",
  document_not_reviewed: "Only reviewed documents can be pushed.",
  document_type_not_pushable: "This document's type can't be pushed to accounting.",
  no_active_connection: "No active accounting connection — connect one from Settings → Integrations first.",
  matcher_value_required: "That rule needs a supplier name to match.",
  account_required: "That rule needs an account to assign.",
  coding_data_required: "No coding was given.",
  proposal_unavailable: "Couldn't prepare that action right now.",
  approval_workflows_not_enabled: "Approval workflows aren't enabled for this workspace.",
  expense_approvals_not_enabled: "Expense approvals aren't enabled for this workspace.",
  review_task_has_no_workflow: "That review task isn't on an approval workflow.",
  expense_claim_not_found: "That expense claim no longer exists.",
  expense_claim_not_submitted: "That expense claim isn't awaiting a decision.",
}

/** Renders one finance-agent Act tool's result (lib/finance/actions.ts) as an Accept/Dismiss card
 * — the confirm-before-execute counterpart to the sheet assistant's write-then-undo cell tools
 * (components/assistant/pending-changes.ts). The tool call itself never mutated anything; Accept
 * is the first and only moment the real server action runs. */
export function FinanceProposalPart({ workspaceId, state, output }: {
  workspaceId: string
  state: "input-streaming" | "input-available" | "output-available" | "output-error"
  output?: FinanceProposalResult
}) {
  const router = useRouter()
  const [resolved, setResolved] = useState<"accepted" | "dismissed" | null>(null)
  const [pending, setPending] = useState(false)

  if (state !== "output-available" || !output) {
    return <p className="flex items-center gap-1.5 text-xs text-stone-500"><Loader2 className="h-3 w-3 animate-spin" />Preparing…</p>
  }
  if ("error" in output) {
    return <p className="rounded-md bg-red-50 px-2.5 py-2 text-xs text-red-700">{ERROR_MESSAGES[output.error] ?? output.error}</p>
  }

  const accept = async () => {
    setPending(true)
    try {
      const result = await runProposal(workspaceId, output)
      if (!result.success) { toast.error(result.error); setPending(false); return }
      setResolved("accepted")
      toast.success("Done")
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
      setPending(false)
    }
  }

  if (resolved === "accepted") {
    return <p className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800"><CircleCheck className="h-3.5 w-3.5 shrink-0" />{output.summary} — done</p>
  }
  if (resolved === "dismissed") {
    return <p className="flex items-center gap-1.5 rounded-md bg-stone-50 px-2.5 py-2 text-xs text-stone-500"><X className="h-3.5 w-3.5 shrink-0" />Dismissed</p>
  }

  return <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
    <p className="text-sm text-amber-900">{output.summary}</p>
    <div className="flex gap-2">
      <button type="button" disabled={pending} onClick={() => void accept()}
        className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
        {pending ? "Working…" : "Accept"}
      </button>
      <button type="button" disabled={pending} onClick={() => setResolved("dismissed")}
        className="rounded-md border border-stone-300 px-2.5 py-1 text-xs font-semibold text-stone-600 hover:bg-stone-100 disabled:opacity-50">
        Dismiss
      </button>
    </div>
  </div>
}

async function runProposal(workspaceId: string, proposal: Exclude<FinanceProposalResult, { error: string }>): Promise<{ success: boolean; error: string }> {
  switch (proposal.kind) {
    case "approve_review_tasks": {
      const result = await bulkUpdateReviewTaskStatusAction(workspaceId, proposal.taskIds, "approved")
      return { success: result.success, error: result.error ?? "" }
    }
    case "reject_review_task": {
      const result = await updateReviewTaskStatusAction(workspaceId, proposal.taskId, "rejected")
      return { success: result.success, error: result.error ?? "" }
    }
    case "set_document_coding": {
      const result = await setDocumentCodingAction(workspaceId, proposal.documentId, proposal.codingData)
      return { success: result.success, error: result.error ?? "" }
    }
    case "create_supplier_rule": {
      const formData = new FormData()
      formData.set("name", proposal.name)
      formData.set("matcherType", proposal.matcherType)
      formData.set("matcherValue", proposal.matcherValue)
      formData.set("account", proposal.account)
      if (proposal.requireReview) formData.set("requireReview", "on")
      if (proposal.autopublish) formData.set("autopublish", "on")
      const result = await createAutomationRuleAction(workspaceId, formData)
      return { success: result.success, error: result.error ?? "" }
    }
    case "push_to_accounting": {
      const result = await pushDocumentToAccountingAction(workspaceId, proposal.documentId, proposal.connectionId)
      return { success: result.success, error: result.error ?? "" }
    }
    case "decide_review_task_stage": {
      const result = await decideReviewTaskStageAction(workspaceId, proposal.taskId, proposal.decision)
      return { success: result.success, error: result.error ?? "" }
    }
    case "decide_expense_claim": {
      const result = await decideExpenseClaimAction(workspaceId, proposal.claimId, proposal.hasWorkflow, proposal.decision)
      return { success: result.success, error: result.error ?? "" }
    }
  }
}
