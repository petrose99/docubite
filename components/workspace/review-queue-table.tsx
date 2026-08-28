"use client"

import { bulkUpdateReviewTaskStatusAction } from "@/app/(app)/workspaces/[workspaceId]/review-actions"
import Link from "next/link"
import { useState } from "react"
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
    /** The lowest per-field confidence score on the document (lib/document-templates.ts's
     * extractFieldConfidence writes these) — the weakest link is what a reviewer actually needs
     * to know before trusting the row, not an average that a single bad field wouldn't move. */
    minConfidence: number | null
    appliedRuleName: string | null
    checks: { code: string; status: "warn" | "fail"; message: string }[]
  }
  assignee: { id: string; name: string } | null
}

const REASON_LABELS: Record<string, string> = { manual: "Manual", low_confidence: "Low confidence", rule_required: "Rule required", check_failed: "Check failed" }

const CHECK_LABELS: Record<string, string> = {
  duplicate: "Duplicate",
  invoice_arithmetic: "Arithmetic",
  statement_balance: "Balance",
  missing_statement_period: "Gap",
  tax_consistency: "Tax",
  suspicious_resubmission: "Resubmission",
}

function ConfidenceDot({ score }: { score: number | null }) {
  if (score === null) return null
  const color = score >= 0.8 ? "bg-emerald-500" : score >= 0.5 ? "bg-amber-500" : "bg-red-500"
  return <span
    className={`inline-block h-2 w-2 rounded-full ${color}`}
    title={`Lowest field confidence: ${Math.round(score * 100)}%`}
  />
}

export function ReviewQueueTable({ workspaceId, tasks }: { workspaceId: string; tasks: ReviewQueueRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState(false)

  const toggle = (id: string) => setSelected((previous) => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const toggleAll = () => setSelected((previous) => (previous.size === tasks.length ? new Set() : new Set(tasks.map((task) => task.id))))

  const bulk = async (status: string) => {
    if (!selected.size) return
    setPending(true)
    try {
      const result = await bulkUpdateReviewTaskStatusAction(workspaceId, [...selected], status)
      if (!result.success) { toast.error(result.error || "Could not update the selected tasks"); return }
      toast.success(`${result.data?.updated ?? 0} task${result.data?.updated === 1 ? "" : "s"} updated`)
      setSelected(new Set())
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false) }
  }

  if (!tasks.length) return <div className="rounded-md border border-dashed p-8 text-center text-sm text-stone-500">
    Nothing here. Documents land in this queue when a supplier rule needs confirmation, a field is read at low
    confidence, or a document check (duplicate, arithmetic, tax, or a gap) fires — or when someone adds one manually
    from a document&apos;s page.
  </div>

  return <div>
    {selected.size > 0 && <div className="mb-2 flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm">
      <span className="font-medium text-emerald-900">{selected.size} selected</span>
      <button type="button" disabled={pending} className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50" onClick={() => void bulk("approved")}>Approve</button>
      <button type="button" disabled={pending} className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50" onClick={() => void bulk("rejected")}>Reject</button>
    </div>}
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b text-left text-stone-500">
          <th className="w-8 py-2"><input type="checkbox" checked={selected.size === tasks.length} onChange={toggleAll} aria-label="Select all" /></th>
          <th className="w-6 py-2"></th>
          <th className="py-2 pr-4 font-medium">Document</th>
          <th className="py-2 pr-4 font-medium">Flags</th>
          <th className="py-2 pr-4 font-medium">Reason</th>
          <th className="py-2 pr-4 font-medium">Status</th>
          <th className="py-2 pr-4 font-medium">Assignee</th>
          <th className="py-2 font-medium">Due</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map((task) => (
          <tr key={task.id} className="border-b last:border-0 hover:bg-stone-50">
            <td className="py-2"><input type="checkbox" checked={selected.has(task.id)} onChange={() => toggle(task.id)} aria-label={`Select ${task.document.filename}`} /></td>
            <td className="py-2"><ConfidenceDot score={task.document.minConfidence} /></td>
            <td className="py-2 pr-4"><Link className="font-medium text-emerald-700 hover:underline" href={`/workspaces/${workspaceId}/review/${task.id}`}>{task.document.filename}</Link>{task.document.templateName && <span className="ml-1.5 text-xs text-stone-400">{task.document.templateName}</span>}</td>
            <td className="py-2 pr-4">
              <div className="flex flex-wrap gap-1">
                {task.document.appliedRuleName && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600" title={`Rule: ${task.document.appliedRuleName}`}>Rule applied</span>}
                {task.document.checks.map((check) => (
                  <span key={check.code} title={check.message}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${check.status === "fail" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
                    {CHECK_LABELS[check.code] ?? check.code}
                  </span>
                ))}
              </div>
            </td>
            <td className="py-2 pr-4 text-stone-600">{REASON_LABELS[task.reason] || task.reason}</td>
            <td className="py-2 pr-4"><span className="rounded-full border px-2 py-0.5 text-xs font-medium capitalize text-stone-600">{task.status.replace("_", " ")}</span></td>
            <td className="py-2 pr-4 text-stone-600">{task.assignee?.name || "Unassigned"}</td>
            <td className="py-2 text-stone-500">{task.dueAt ? new Date(task.dueAt).toLocaleDateString() : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
}
