"use client"

import { assignReviewTaskAction, bulkUpdateReviewTaskStatusAction, decideReviewTaskStageAction, getReviewTaskDetailAction, startWorkflowOnReviewTaskAction, updateReviewTaskStatusAction } from "@/app/(app)/workspaces/[workspaceId]/review-actions"
import { pushDocumentToAccountingAction } from "@/app/(app)/workspaces/[workspaceId]/integration-push-actions"
import { AssistantPanel } from "@/components/assistant/assistant-panel"
import { DocumentPreview } from "@/components/documents/document-preview"
import { AutomationRuleForm } from "@/components/workspace/automation-rule-form"
import type { FUniver } from "@univerjs/presets"
import { Sparkles } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

export type ReviewQueueRow = {
  id: string
  status: string
  reason: string
  priority: number
  dueAt: string | null
  document: {
    id: string
    filename: string
    templateName: string | null
    minConfidence: number | null
    appliedRuleName: string | null
    checks: { code: string; status: "warn" | "fail"; message: string }[]
  }
  assignee: { id: string; name: string } | null
}

type TaskDetail = Awaited<ReturnType<typeof getReviewTaskDetailAction>>

const REASON_LABELS: Record<string, string> = { manual: "Manual", low_confidence: "Low confidence", rule_required: "Rule required", check_failed: "Check failed" }
const CHECK_LABELS: Record<string, string> = {
  duplicate: "Duplicate", invoice_arithmetic: "Arithmetic", statement_balance: "Balance",
  missing_statement_period: "Gap", tax_consistency: "Tax", suspicious_resubmission: "Resubmission",
}
const STATUS_OPTIONS = ["open", "in_review", "approved", "rejected"]

function ConfidenceDot({ score }: { score: number | null }) {
  if (score === null) return null
  const color = score >= 0.8 ? "bg-emerald-500" : score >= 0.5 ? "bg-amber-500" : "bg-red-500"
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} title={`Lowest field confidence: ${Math.round(score * 100)}%`} />
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

/** The costs-inbox split view: a keyboard-driven list on the left, the selected document's
 * preview/fields/controls on the right — reusing DocumentPreview and AutomationRuleForm rather
 * than duplicating either. `j`/`k` move the selection, `e` approves, `p` pushes when the selected
 * document is push-eligible; all three are optimistic (the row leaves the current tab's list, or
 * the push button reflects "Pushed", immediately) with an undo toast backing out the server change
 * if the person didn't mean it. Shortcuts are ignored while any form control has focus, so they
 * never fight with the create-rule form or a text field. */
export function ReviewInbox({ workspaceId, tasks, currentStatus, members, financeAgentEnabled, documentSearchEnabled }: {
  workspaceId: string
  tasks: ReviewQueueRow[]
  /** The active status tab ("open" by default) — undefined/"all" means no client-side filtering
   * on top of what the server already returned. */
  currentStatus: string | undefined
  members: { id: string; name: string }[]
  /** Whether the finance-agent module is on — gates the Assistant button entirely, since without
   * it /api/ai-chat registers none of the finance tools and the panel would have nothing to do. */
  financeAgentEnabled: boolean
  documentSearchEnabled: boolean
}) {
  const router = useRouter()
  const [assistantOpen, setAssistantOpen] = useState(false)
  // The assistant is shared with the spreadsheet, where it drives a live Univer grid through this
  // ref. There is no grid here — surface="finance-inbox" stops the server registering the tools
  // that would need one — so this stays null for the page's whole life.
  const noGrid = useRef<FUniver | null>(null)
  const [optimisticStatus, setOptimisticStatus] = useState<Record<string, string>>({})
  const [selectedId, setSelectedId] = useState<string | null>(tasks[0]?.id ?? null)
  const [detail, setDetail] = useState<TaskDetail>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState(false)
  const [pushed, setPushed] = useState<Set<string>>(new Set())
  const detailTaskIdRef = useRef<string | null>(null)

  // Adjusted during render (React's own recommended pattern for "reset derived state when a prop
  // changes") rather than in an effect: the server already refetched a tab-filtered list on
  // revalidate, so once its `tasks` prop is a new reference there is nothing left for the
  // optimistic overlay to hide.
  const [tasksSeen, setTasksSeen] = useState(tasks)
  if (tasks !== tasksSeen) {
    setTasksSeen(tasks)
    setOptimisticStatus({})
    setPushed(new Set())
  }

  const visibleTasks = useMemo(() => tasks.filter((task) => {
    const status = optimisticStatus[task.id] ?? task.status
    return !currentStatus || currentStatus === "all" || status === currentStatus
  }), [tasks, optimisticStatus, currentStatus])

  // Same render-time adjustment: if the selection fell out of view (approved off the Open tab,
  // or the list itself just changed), snap to the first visible row instead of a dangling id.
  const effectiveSelectedId = selectedId && visibleTasks.some((task) => task.id === selectedId) ? selectedId : (visibleTasks[0]?.id ?? null)
  if (effectiveSelectedId !== selectedId) setSelectedId(effectiveSelectedId)

  useEffect(() => {
    if (!effectiveSelectedId) { setDetail(null); return }
    detailTaskIdRef.current = effectiveSelectedId
    setDetailLoading(true)
    getReviewTaskDetailAction(workspaceId, effectiveSelectedId).then((result) => {
      // A fast j/k could have moved the selection again before this resolves — drop a stale
      // response rather than paint the wrong document into the pane.
      if (detailTaskIdRef.current === effectiveSelectedId) { setDetail(result); setDetailLoading(false) }
    })
  }, [effectiveSelectedId, workspaceId])

  // router.refresh() only re-renders the server-rendered list (`tasks`) — the detail pane is
  // client state fetched once per selection change (the effect above), so a workflow decision or
  // a fresh workflow start has to explicitly re-fetch it or the pane just keeps showing the stage
  // it was on before the click, forever, since effectiveSelectedId never changes underneath it.
  const refetchDetail = useCallback(async (taskId: string) => {
    const result = await getReviewTaskDetailAction(workspaceId, taskId)
    if (detailTaskIdRef.current === taskId) setDetail(result)
  }, [workspaceId])

  const changeStatus = useCallback(async (taskId: string, status: string, previousStatus: string) => {
    setOptimisticStatus((previous) => ({ ...previous, [taskId]: status }))
    try {
      const result = await updateReviewTaskStatusAction(workspaceId, taskId, status)
      if (!result.success) {
        setOptimisticStatus((previous) => ({ ...previous, [taskId]: previousStatus }))
        toast.error(result.error || "Could not update status")
        return
      }
      toast.success(`Marked ${status.replace("_", " ")}`, {
        action: {
          label: "Undo",
          onClick: () => {
            setOptimisticStatus((previous) => ({ ...previous, [taskId]: previousStatus }))
            void updateReviewTaskStatusAction(workspaceId, taskId, previousStatus).then(() => router.refresh())
          },
        },
      })
      router.refresh()
    } catch {
      setOptimisticStatus((previous) => ({ ...previous, [taskId]: previousStatus }))
      toast.error("Could not reach the server")
    }
  }, [workspaceId, router])

  const decideStage = useCallback(async (taskId: string, decision: "approve" | "reject") => {
    setPending(true)
    try {
      const result = await decideReviewTaskStageAction(workspaceId, taskId, decision)
      if (!result.success) { toast.error(result.error || "Could not record that decision"); return }
      toast.success(decision === "approve" ? "Stage approved" : "Rejected")
      await refetchDetail(taskId)
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false) }
  }, [workspaceId, router, refetchDetail])

  const startWorkflow = async (taskId: string, workflowId: string) => {
    if (!workflowId) return
    setPending(true)
    try {
      const result = await startWorkflowOnReviewTaskAction(workspaceId, taskId, workflowId)
      if (!result.success) { toast.error(result.error || "Could not start that workflow"); return }
      toast.success("Workflow started")
      await refetchDetail(taskId)
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false) }
  }

  const pushSelected = useCallback(async () => {
    if (!detail?.canPush || !detail.activeConnectionId || pushed.has(detail.id)) return
    setPushed((previous) => new Set(previous).add(detail.id))
    try {
      const result = await pushDocumentToAccountingAction(workspaceId, detail.document.id, detail.activeConnectionId)
      if (!result.success) {
        setPushed((previous) => { const next = new Set(previous); next.delete(detail.id); return next })
        toast.error(result.error || "Could not push this document")
        return
      }
      toast.success("Pushed to accounting")
    } catch {
      setPushed((previous) => { const next = new Set(previous); next.delete(detail.id); return next })
      toast.error("Could not reach the server")
    }
  }, [workspaceId, detail, pushed])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return
      if (!visibleTasks.length) return
      const index = effectiveSelectedId ? visibleTasks.findIndex((task) => task.id === effectiveSelectedId) : -1
      if (event.key === "j") {
        event.preventDefault()
        setSelectedId(visibleTasks[Math.min(index + 1, visibleTasks.length - 1)]?.id ?? visibleTasks[0].id)
      } else if (event.key === "k") {
        event.preventDefault()
        setSelectedId(visibleTasks[Math.max(index - 1, 0)]?.id ?? visibleTasks[0].id)
      } else if (event.key === "e" && effectiveSelectedId) {
        event.preventDefault()
        const task = visibleTasks.find((t) => t.id === effectiveSelectedId)
        if (!task) return
        // A task on a workflow needs its current stage decided, not a direct status write — and
        // that requires the loaded detail (for canDecideCurrentStage), not just the list row.
        if (detail && detail.id === task.id && detail.workflow) {
          if (detail.workflow.canDecideCurrentStage) void decideStage(task.id, "approve")
        } else if (!detail?.workflow) {
          void changeStatus(task.id, "approved", optimisticStatus[task.id] ?? task.status)
        }
      } else if (event.key === "p") {
        event.preventDefault()
        void pushSelected()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [visibleTasks, effectiveSelectedId, detail, optimisticStatus, changeStatus, decideStage, pushSelected])

  const toggleBulk = (id: string) => setBulkSelected((previous) => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggleBulkAll = () => setBulkSelected((previous) => (previous.size === visibleTasks.length ? new Set() : new Set(visibleTasks.map((task) => task.id))))

  const bulk = async (status: string) => {
    if (!bulkSelected.size) return
    setPending(true)
    const ids = [...bulkSelected]
    setOptimisticStatus((previous) => { const next = { ...previous }; for (const id of ids) next[id] = status; return next })
    try {
      const result = await bulkUpdateReviewTaskStatusAction(workspaceId, ids, status)
      if (!result.success) { toast.error(result.error || "Could not update the selected tasks"); return }
      toast.success(`${result.data?.updated ?? 0} task${result.data?.updated === 1 ? "" : "s"} updated`)
      setBulkSelected(new Set())
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false) }
  }

  const setAssignee = async (taskId: string, value: string) => {
    const result = await assignReviewTaskAction(workspaceId, taskId, value || null)
    if (!result.success) toast.error(result.error || "Could not assign")
    router.refresh()
  }

  const assistantButton = financeAgentEnabled && <button
    type="button"
    onClick={() => setAssistantOpen((open) => !open)}
    aria-pressed={assistantOpen}
    className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${assistantOpen ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-stone-200 text-stone-600 hover:bg-stone-50"}`}>
    <Sparkles className="h-3.5 w-3.5" />Assistant
  </button>

  if (!tasks.length) return <div className="space-y-3">
    <div className="flex">{assistantButton}</div>
    <div className="flex gap-4">
      <div className="flex-1 rounded-md border border-dashed p-8 text-center text-sm text-stone-500">
        Nothing here. Documents land in this queue when a supplier rule needs confirmation, a field is read at low
        confidence, or a document check (duplicate, arithmetic, tax, or a gap) fires — or when someone adds one
        manually from a document&apos;s page.
      </div>
      {assistantOpen && <AssistantPanel
        workspaceId={workspaceId}
        apiRef={noGrid}
        surface="finance-inbox"
        title="Finance assistant"
        className="flex w-80 shrink-0 flex-col rounded-md border bg-stone-50"
        documentSearchEnabled={documentSearchEnabled}
        emptyHint="Ask about the review inbox, a document's coding, or supplier rules."
        intents={["Summarize what needs attention", "List the active supplier rules"]}
        onClose={() => setAssistantOpen(false)} />}
    </div>
  </div>

  return <div className="space-y-3">
    <div className="flex">{assistantButton}</div>
    <div className="flex gap-4">
    <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
    <div>
      {bulkSelected.size > 0 && <div className="sticky top-2 z-10 mb-2 flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm shadow-sm">
        <span className="font-medium text-emerald-900">{bulkSelected.size} selected</span>
        <button type="button" disabled={pending} className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50" onClick={() => void bulk("approved")}>Approve</button>
        <button type="button" disabled={pending} className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50" onClick={() => void bulk("rejected")}>Reject</button>
      </div>}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-stone-500">
            <th className="w-8 py-2"><input type="checkbox" checked={bulkSelected.size === visibleTasks.length && visibleTasks.length > 0} onChange={toggleBulkAll} aria-label="Select all" /></th>
            <th className="w-6 py-2"></th>
            <th className="py-2 pr-4 font-medium">Document</th>
            <th className="py-2 pr-4 font-medium">Flags</th>
            <th className="py-2 pr-4 font-medium">Reason</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {visibleTasks.map((task) => {
            const status = optimisticStatus[task.id] ?? task.status
            const selected = task.id === effectiveSelectedId
            return <tr key={task.id} onClick={() => setSelectedId(task.id)}
              className={`cursor-pointer border-b last:border-0 ${selected ? "bg-emerald-50" : "hover:bg-stone-50"}`}>
              <td className="py-2" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={bulkSelected.has(task.id)} onChange={() => toggleBulk(task.id)} aria-label={`Select ${task.document.filename}`} /></td>
              <td className="py-2"><ConfidenceDot score={task.document.minConfidence} /></td>
              <td className="py-2 pr-4"><span className="font-medium text-stone-900">{task.document.filename}</span>{task.document.templateName && <span className="ml-1.5 text-xs text-stone-400">{task.document.templateName}</span>}</td>
              <td className="py-2 pr-4">
                <div className="flex flex-wrap gap-1">
                  {task.document.appliedRuleName && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600" title={`Rule: ${task.document.appliedRuleName}`}>Rule applied</span>}
                  {task.document.checks.map((check) => (
                    <span key={check.code} title={check.message} className={`rounded-full px-2 py-0.5 text-xs font-medium ${check.status === "fail" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
                      {CHECK_LABELS[check.code] ?? check.code}
                    </span>
                  ))}
                </div>
              </td>
              <td className="py-2 pr-4 text-stone-600">{REASON_LABELS[task.reason] || task.reason}</td>
              <td className="py-2"><span className="rounded-full border px-2 py-0.5 text-xs font-medium capitalize text-stone-600">{status.replace("_", " ")}</span></td>
            </tr>
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-stone-400">Click a row, or use <kbd className="rounded border px-1">j</kbd>/<kbd className="rounded border px-1">k</kbd> to move, <kbd className="rounded border px-1">e</kbd> to approve, <kbd className="rounded border px-1">p</kbd> to push.</p>
    </div>

    <div className="sticky top-4 self-start rounded border">
      {!effectiveSelectedId ? (
        <div className="p-6 text-center text-sm text-stone-400">Select a document to review.</div>
      ) : detailLoading || !detail ? (
        <div className="space-y-3 p-4">
          <div className="h-4 w-2/3 animate-pulse rounded bg-stone-100" />
          <div className="h-40 animate-pulse rounded bg-stone-100" />
        </div>
      ) : (
        <div className="max-h-[80vh] overflow-y-auto p-4">
          <h2 className="font-bold text-stone-900">{detail.document.filename}</h2>

          {detail.document.storageKey
            ? <DocumentPreview src={`/api/documents/${detail.document.id}/source`} filename={detail.document.filename} mimeType={detail.document.mimeType} className="mt-3 h-64 rounded border" />
            : <p className="mt-3 rounded border border-dashed p-4 text-center text-xs text-stone-400">Source not available</p>}

          <div className="mt-4 space-y-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-stone-500">Assignee</label>
            <select className="w-full rounded-md border px-2.5 py-1.5 text-sm" defaultValue={detail.assigneeId ?? ""} onChange={(event) => void setAssignee(detail.id, event.target.value)}>
              <option value="">Unassigned</option>
              {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </div>

          {detail.workflow ? (
            <div className="mt-3">
              <label className="block text-xs font-semibold uppercase tracking-wide text-stone-500">{detail.workflow.name}</label>
              <p className="mt-1 text-xs text-stone-500">
                Stage {detail.workflow.currentStageIndex + 1} of {detail.workflow.stages.length}: {detail.workflow.stages[detail.workflow.currentStageIndex]?.name}
                {detail.workflow.stages[detail.workflow.currentStageIndex]?.requireOwner ? " (owner only)" : ""}
              </p>
              {detail.status === "in_review" ? (
                detail.workflow.canDecideCurrentStage ? (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <button type="button" disabled={pending} className="rounded-md bg-emerald-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50" onClick={() => void decideStage(detail.id, "approve")}>Approve stage</button>
                    <button type="button" disabled={pending} className="rounded-md border border-red-300 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50" onClick={() => void decideStage(detail.id, "reject")}>Reject</button>
                  </div>
                ) : <p className="mt-1.5 text-xs text-amber-700">Only a workspace owner can decide this stage.</p>
              ) : <p className="mt-1.5 text-xs font-medium capitalize text-stone-600">{detail.status.replace("_", " ")}</p>}
            </div>
          ) : (
            <div className="mt-3">
              <label className="block text-xs font-semibold uppercase tracking-wide text-stone-500">Status</label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {STATUS_OPTIONS.map((option) => {
                  const current = optimisticStatus[detail.id] ?? detail.status
                  return <button key={option} type="button" disabled={current === option}
                    className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold capitalize transition-colors ${current === option ? "border-emerald-700 bg-emerald-50 text-emerald-800" : "hover:bg-stone-50"}`}
                    onClick={() => void changeStatus(detail.id, option, current)}>
                    {option.replace("_", " ")}
                  </button>
                })}
              </div>
              {detail.availableWorkflows.length > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <select className="flex-1 rounded-md border px-2.5 py-1.5 text-xs" defaultValue="" onChange={(event) => void startWorkflow(detail.id, event.target.value)}>
                    <option value="" disabled>Start an approval workflow…</option>
                    {detail.availableWorkflows.map((wf) => <option key={wf.id} value={wf.id}>{wf.name} ({wf.stageCount} stage{wf.stageCount === 1 ? "" : "s"})</option>)}
                  </select>
                </div>
              )}
            </div>
          )}

          {detail.canPush && <button type="button" disabled={pushed.has(detail.id)}
            className="mt-3 w-full rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            onClick={() => void pushSelected()}>
            {pushed.has(detail.id) ? "Pushed" : "Push to accounting"}
          </button>}

          {detail.checkResults.length > 0 && <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Checks</h3>
            <ul className="mt-1.5 space-y-1.5 text-sm">
              {detail.checkResults.map((check) => (
                <li key={check.id} className="flex items-start gap-2">
                  <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${check.status === "fail" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{check.status}</span>
                  <span className="text-stone-600">{check.message}</span>
                </li>
              ))}
            </ul>
          </div>}

          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Extracted fields</h3>
            <dl className="mt-1.5 space-y-1.5 text-sm">
              {detail.document.fields.map((field) => (
                <div key={field.key} className="flex justify-between gap-3">
                  <dt className="text-stone-500">{field.label}</dt>
                  <dd className="text-right font-medium text-stone-900">{formatValue(detail.document.values[field.key])}</dd>
                </div>
              ))}
            </dl>
          </div>

          {detail.canCreateRule && <details className="mt-4 rounded border p-3">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-stone-500">Create a rule from this document</summary>
            <div className="mt-3"><AutomationRuleForm workspaceId={workspaceId} defaultSupplier={detail.document.supplier} /></div>
          </details>}
        </div>
      )}
    </div>
    </div>
    {assistantOpen && <AssistantPanel
      workspaceId={workspaceId}
      apiRef={noGrid}
      surface="finance-inbox"
      title="Finance assistant"
      className="flex w-80 shrink-0 flex-col rounded-md border bg-stone-50"
      documentSearchEnabled={documentSearchEnabled}
      emptyHint="Ask about the review inbox, a document's coding, or supplier rules."
      intents={["Summarize what needs attention", "List the active supplier rules"]}
      onClose={() => setAssistantOpen(false)} />}
    </div>
  </div>
}
