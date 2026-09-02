/** Phase D: one Activity-tab metric card — a big number/rate plus a short subtext, the same visual
 * weight as the dashboard's stat tiles (app/(app)/workspaces/[workspaceId]/page.tsx's `stats` grid:
 * rounded-xl border bg-white p-4, a big bold number, a small slate label) rather than
 * finding-card.tsx's severity-badged row: these are metrics to glance at, not issues with a Dismiss
 * button. checkCode picks which field of suggestedActionPayload becomes the headline number; an
 * unrecognised checkCode (there shouldn't be one) falls back to the finding's own title so the card
 * never renders blank. */
import type { HealthFindingRow } from "@/components/health/finding-card"

function formatDurationMs(ms: number): string {
  const hours = ms / (60 * 60 * 1000)
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60000))}m`
  if (hours < 48) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)}d`
}

function headline(finding: HealthFindingRow): string {
  const payload = (finding.suggestedActionPayload ?? {}) as Record<string, unknown>
  switch (finding.checkCode) {
    case "submission_volume":
      return String(payload.currentCount ?? "—")
    case "automation_rate":
    case "reconciliation_rate": {
      const rate = payload.rate
      return typeof rate === "number" ? `${Math.round(rate)}%` : "—"
    }
    case "processing_time": {
      const medianMs = payload.medianMs
      return typeof medianMs === "number" ? formatDurationMs(medianMs) : "—"
    }
    default:
      return finding.title
  }
}

const LABEL_BY_CHECK: Record<string, string> = {
  submission_volume: "documents (last 30 days)",
  automation_rate: "auto-coded by a rule",
  processing_time: "median time to review",
  reconciliation_rate: "ledger transactions reconciled",
}

export function ActivityStatCard({ finding }: { finding: HealthFindingRow }) {
  return <div className="rounded-xl border bg-white p-4 shadow-sm">
    <div className="text-[26px] font-extrabold tracking-tight text-slate-900">{headline(finding)}</div>
    <div className="mt-0.5 text-[13px] text-slate-500">{LABEL_BY_CHECK[finding.checkCode] ?? finding.title}</div>
    <p className="mt-2 text-xs text-slate-500">{finding.description}</p>
  </div>
}
