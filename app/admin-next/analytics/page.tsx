import { getAnalyticsRollup } from "@/lib/analytics-rollups"
import { requireAdminPage } from "@/lib/admin"

export const dynamic = "force-dynamic"

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="rounded border p-4">
    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
    <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
    {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
  </div>
}

const formatPercent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`)
const formatMs = (value: number | null) => {
  if (value === null) return "—"
  if (value < 60_000) return `${Math.round(value / 1000)}s`
  return `${Math.round(value / 60_000)}m`
}

/** The six headline metrics WP5 exists to answer, over the trailing 7 days. A sibling of the
 * generated /admin-next console for the same reason app/admin-next/baa is: this reads
 * cross-workspace aggregates raw SQL computes (lib/analytics-rollups.ts), not a CRUD list over
 * one table next-admin could render on its own. */
export default async function AnalyticsPage() {
  await requireAdminPage()
  const rollup = await getAnalyticsRollup(7)

  return <main className="mx-auto max-w-4xl space-y-6 p-6">
    <header>
      <h1 className="text-2xl font-bold text-slate-900">Product analytics</h1>
      <p className="mt-1 text-sm text-slate-600">Trailing 7 days, from first-party events only — see lib/analytics.ts.</p>
    </header>

    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      <Stat label="Weekly active workspaces" value={String(rollup.weeklyActiveWorkspaces)} />
      <Stat label="Documents uploaded" value={String(rollup.documentsUploaded)} />
      <Stat label="Extractions completed" value={String(rollup.extractionsCompleted)} hint={`${formatPercent(rollup.extractionSuccessRate)} succeeded`} />
      <Stat label="Time to first extraction" value={formatMs(rollup.medianTimeToFirstExtractionMs)} hint="median" />
      <Stat label="Corrections saved" value={String(rollup.correctionsSaved)} />
      <Stat label="Exports" value={String(rollup.exportsCount)} />
    </div>
  </main>
}
