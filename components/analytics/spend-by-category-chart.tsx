import type { SpendByCategoryRow } from "@/lib/analytics/workspace-analytics"
import Link from "next/link"

const TOP_N = 10

/** Horizontal meter-bars, one per account category — the billing page's `Meter` idiom reused for a
 * ranked list instead of a single used/limit gauge. Categories beyond the top 10 roll up into a
 * single "Other" bar so a workspace with a long tail of one-off accounts still reads at a glance. */
export function SpendByCategoryChart({ workspaceId, rows, formatMoney }: {
  workspaceId: string
  rows: SpendByCategoryRow[]
  formatMoney: (value: number) => string
}) {
  if (!rows.length) {
    return <section className="space-y-2">
      <h2 className="text-lg font-semibold text-slate-900">Spend by category</h2>
      <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">
        No categorized spend yet. <Link href={`/workspaces/${workspaceId}/settings/rules`} className="font-medium text-emerald-700 hover:underline">Set up supplier rules</Link> to auto-code documents by account.
      </p>
    </section>
  }

  const top = rows.slice(0, TOP_N)
  const rest = rows.slice(TOP_N)
  const otherTotal = rest.reduce((sum, row) => sum + row.totalSpend, 0)
  const otherCount = rest.reduce((sum, row) => sum + row.documentCount, 0)
  const bars = otherTotal > 0 ? [...top, { category: "Other", totalSpend: otherTotal, documentCount: otherCount }] : top
  const max = Math.max(...bars.map((bar) => bar.totalSpend), 1)

  return <section className="space-y-3">
    <div>
      <h2 className="text-lg font-semibold text-slate-900">Spend by category</h2>
      <p className="text-xs text-slate-500">Based on costs and expenses. Sales/revenue not tracked.</p>
    </div>
    <div className="space-y-2">
      {bars.map((row) => {
        const percent = Math.max(Math.round((row.totalSpend / max) * 100), 2)
        return <div key={row.category} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            {row.category === "Uncategorized"
              ? <Link href={`/workspaces/${workspaceId}/review`} className="font-medium text-slate-700 hover:text-emerald-700 hover:underline">Uncategorized</Link>
              : <span className="truncate font-medium text-slate-700">{row.category}</span>}
            <span className="shrink-0 text-slate-500">{formatMoney(row.totalSpend)} · {row.documentCount} doc{row.documentCount === 1 ? "" : "s"}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-600" style={{ width: `${percent}%` }} />
          </div>
        </div>
      })}
    </div>
  </section>
}
