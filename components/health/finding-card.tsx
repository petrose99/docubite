"use client"

import { dismissHealthFindingAction, retryPushAction, voidDuplicateAction } from "@/app/(app)/workspaces/[workspaceId]/health-actions"
import { Button } from "@/components/ui/button"
import type { HealthCategory, HealthSeverity } from "@/lib/health/types"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"

export type HealthFindingRow = {
  id: string
  checkCode: string
  category: HealthCategory
  severity: HealthSeverity
  title: string
  description: string
  affectedCount?: number
  document: { id: string; filename: string; fileId: string } | null
  /** Phase C: "void_duplicate" | "retry_push" | "create_rule" | null — only the first two have a
   * remediation implemented (lib/health/actions.ts); "create_rule" and any other value render no
   * action button, same as null. */
  suggestedAction?: string | null
  /** Phase D: carried through for activity-category findings so components/health/
   * activity-stat-card.tsx can render the metric number directly instead of parsing it back out of
   * the description text. Unused by FindingCard itself. */
  suggestedActionPayload?: Record<string, unknown> | null
}

// Phase C: the only two suggestedAction values with a real remediation wired up
// (app/(app)/workspaces/[workspaceId]/health-actions.ts) — a finding with any other suggestedAction
// (e.g. rule_coverage's "create_rule", which has no write-back yet) shows no action button at all,
// same as a finding with none.
const REMEDIATION_ACTIONS: Record<string, { label: string; run: typeof voidDuplicateAction }> = {
  void_duplicate: { label: "Void duplicate bill", run: voidDuplicateAction },
  retry_push: { label: "Retry push", run: retryPushAction },
}

const SEVERITY_STYLE: Record<HealthSeverity, string> = {
  critical: "bg-red-100 text-red-800",
  warning: "bg-amber-100 text-amber-800",
  info: "bg-slate-100 text-slate-700",
}

type PreviewState = { message: string } | null

/** One open Health finding: severity badge, title/description, a link to its source document (a
 * document-scoped finding), a Dismiss button, and — for a finding with a remediation wired up,
 * only when the viewer is a workspace owner — a two-step remediation control. Dismissing is
 * optimistic — the card disappears immediately — with a toast surfacing a failure so the finding
 * doesn't silently vanish from view without actually being dismissed.
 *
 * The remediation control is deliberately NOT a single click: the first click calls the server
 * action with dryRun: true and renders its returned preview text inline; only then does a second,
 * distinct "Confirm" button appear, and only that button calls the action again with dryRun: false
 * to actually perform the write. There is no code path from one click to a real write — see the
 * Phase C safety rule this was built from. */
export function FindingCard({ workspaceId, finding, onDismissed, canRemediate = false }: {
  workspaceId: string
  finding: HealthFindingRow
  onDismissed?: (id: string) => void
  /** True only for a viewer whose workspace role is "owner" — the health page computes this once
   * from the same requireWorkspaceRole membership every other owner-gated page already fetches,
   * rather than this component re-deriving or re-fetching role data itself. */
  canRemediate?: boolean
}) {
  const [dismissing, setDismissing] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [preview, setPreview] = useState<PreviewState>(null)
  const [confirming, setConfirming] = useState(false)
  const [resolved, setResolved] = useState(false)
  if (dismissed || resolved) return null

  const remediation = finding.suggestedAction ? REMEDIATION_ACTIONS[finding.suggestedAction] : undefined

  return <div className="flex items-start justify-between gap-4 rounded-lg border bg-white p-4">
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLE[finding.severity]}`}>{finding.severity}</span>
        <h3 className="truncate text-sm font-semibold text-slate-900">{finding.title}</h3>
        {!!finding.affectedCount && finding.affectedCount > 1 && <span className="shrink-0 text-xs text-slate-500">×{finding.affectedCount}</span>}
      </div>
      <p className="text-sm text-slate-600">{finding.description}</p>
      {finding.document && <Link href={`/workspaces/${workspaceId}/documents/${finding.document.id}`} className="text-xs font-medium text-emerald-700 hover:underline">
        View {finding.document.filename}
      </Link>}
      {preview && <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">{preview.message}</p>}
    </div>
    <div className="flex shrink-0 flex-col items-end gap-2">
      <Button type="button" variant="outline" size="sm" disabled={dismissing} onClick={async () => {
        setDismissing(true)
        try {
          const result = await dismissHealthFindingAction(workspaceId, finding.id)
          if (!result.success) throw new Error(result.error)
          setDismissed(true)
          onDismissed?.(finding.id)
        } catch {
          toast.error("Could not dismiss that finding — please try again")
          setDismissing(false)
        }
      }}>{dismissing ? "Dismissing…" : "Dismiss"}</Button>

      {remediation && !canRemediate && <span title="Only a workspace owner can perform this action" className="text-xs text-slate-400">
        {remediation.label} (owner only)
      </span>}

      {remediation && canRemediate && !preview && <Button type="button" variant="secondary" size="sm" disabled={previewing} onClick={async () => {
        setPreviewing(true)
        try {
          const result = await remediation.run(workspaceId, finding.id, true)
          if (!result.success || !result.data) throw new Error(result.error ?? "Could not preview that action")
          setPreview({ message: result.data.message })
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not preview that action")
        } finally {
          setPreviewing(false)
        }
      }}>{previewing ? "Loading preview…" : remediation.label}</Button>}

      {remediation && canRemediate && preview && <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" disabled={confirming} onClick={() => setPreview(null)}>Cancel</Button>
        <Button type="button" variant="destructive" size="sm" disabled={confirming} onClick={async () => {
          setConfirming(true)
          try {
            const result = await remediation.run(workspaceId, finding.id, false)
            if (!result.success || !result.data) throw new Error(result.error ?? "That action failed")
            if (!result.data.ok) throw new Error(result.data.message)
            toast.success(result.data.message)
            setResolved(true)
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "That action failed — please try again")
            setConfirming(false)
          }
        }}>{confirming ? "Confirming…" : "Confirm"}</Button>
      </div>}
    </div>
  </div>
}
