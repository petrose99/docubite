import type { HealthScoreBucket } from "@/lib/health/score"
import { Heart } from "lucide-react"

const WIDTH = 320
const HEIGHT = 64
const PADDING = 4

export type HealthScorePoint = { computedOn: string; score: number }

const BUCKET_COLOR: Record<HealthScoreBucket, string> = {
  good: "text-emerald-600",
  warning: "text-amber-500",
  bad: "text-red-600",
}
const BUCKET_LABEL: Record<HealthScoreBucket, string> = {
  good: "Good",
  warning: "Needs attention",
  bad: "At risk",
}

/** A hand-rolled inline SVG sparkline, matching components/analytics/cash-flow-chart.tsx's own
 * convention: a handful of small, non-interactive charts don't earn a charting-library dependency. */
function Sparkline({ points }: { points: HealthScorePoint[] }) {
  if (points.length < 2) return null
  const max = Math.max(...points.map((p) => p.score), 1)
  const min = Math.min(...points.map((p) => p.score), 0)
  const range = Math.max(max - min, 1)
  const plotWidth = WIDTH - PADDING * 2
  const plotHeight = HEIGHT - PADDING * 2
  const step = plotWidth / (points.length - 1)
  const coordinates = points.map((point, index) => {
    const x = PADDING + index * step
    const y = PADDING + plotHeight - ((point.score - min) / range) * plotHeight
    return `${x},${y}`
  })
  return <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="30-day health score trend">
    <polyline points={coordinates.join(" ")} fill="none" stroke="#047857" strokeWidth={2} />
  </svg>
}

/** Phase E: models/health.ts's getProjectedHealthScore result, threaded straight through — see
 * that file and lib/health/score.ts's projectHealthScore for how it's computed. `null` (the whole
 * prop, not a field of it) means health/page.tsx got null back — no ledger connection, or no
 * pending documents to project — in which case HealthScoreCard renders nothing extra, matching the
 * Phase E spec's "don't render a broken/empty projection UI". */
export type ProjectedScoreProps = {
  projectedScore: number | null
  pendingDocumentCount: number
  riskFactors: string[]
}

/** The Health page's headline card: the current score, its heart-icon bucket, a 30-day sparkline
 * of the daily HealthScore snapshots, and — when a projection is available — a one-line predictive
 * headline ("If 23 pending documents push as-is: 71") plus the risk factors behind it. */
export function HealthScoreCard({ score, bucket, history, projected }: {
  score: number | null
  bucket: HealthScoreBucket | null
  history: HealthScorePoint[]
  /** Omitted or null renders the card exactly as Phase A/B/C shipped it. */
  projected?: ProjectedScoreProps | null
}) {
  return <section className="rounded-lg border bg-white p-6">
    <div className="flex items-start justify-between gap-6">
      <div>
        <p className="text-sm font-medium text-slate-500">Data health score</p>
        <div className="mt-1 flex items-baseline gap-2">
          <Heart className={`h-8 w-8 ${bucket ? BUCKET_COLOR[bucket] : "text-slate-300"}`} fill="currentColor" />
          <span className="text-4xl font-bold text-slate-900">{score === null ? "—" : Math.round(score)}</span>
          {bucket && <span className={`text-sm font-medium ${BUCKET_COLOR[bucket]}`}>{BUCKET_LABEL[bucket]}</span>}
        </div>
        {score === null && <p className="mt-1 text-xs text-slate-500">No checks have run for this workspace yet.</p>}
        {projected && projected.projectedScore !== null && <div className="mt-3 max-w-md">
          <p className="text-sm text-slate-700">
            If {projected.pendingDocumentCount} pending document{projected.pendingDocumentCount === 1 ? "" : "s"} push{projected.pendingDocumentCount === 1 ? "es" : ""} as-is:{" "}
            <span className="font-semibold text-slate-900">{Math.round(projected.projectedScore)}</span>
          </p>
          {projected.riskFactors.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-slate-500">
            {projected.riskFactors.map((factor) => <li key={factor}>{factor}</li>)}
          </ul>}
        </div>}
      </div>
      <div className="w-full max-w-[320px]">
        <Sparkline points={history} />
        {history.length >= 2 && <p className="mt-1 text-xs text-slate-500">Last {history.length} days</p>}
      </div>
    </div>
  </section>
}
