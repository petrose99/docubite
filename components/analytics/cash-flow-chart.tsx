import type { CashFlowMonth } from "@/lib/analytics/workspace-analytics"

const WIDTH = 700
const HEIGHT = 220
const PADDING_X = 24
const PADDING_TOP = 12
const PADDING_BOTTOM = 28

/** One grouped-column SVG chart, hand-rolled rather than a chart library — three fixed,
 * non-interactive charts don't earn a ~100kB client dependency and a "use client" boundary. Outflow
 * (document totals + bank debits) is always shown; bank inflow only appears once a bank statement
 * has actually been extracted, so a finance-only workspace with no bank_statement documents doesn't
 * show a permanently-empty second series. */
export function CashFlowChart({ months, formatMoney }: {
  months: CashFlowMonth[]
  formatMoney: (value: number) => string
}) {
  if (!months.length) return null

  const hasBankData = months.some((month) => month.bankDebits > 0 || month.bankCredits > 0)
  const max = Math.max(...months.map((month) => Math.max(month.outflow, month.bankCredits)), 1)
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM
  const groupWidth = (WIDTH - PADDING_X * 2) / months.length
  const barWidth = Math.min(28, groupWidth / (hasBankData ? 3.2 : 2.2))
  const scale = (value: number) => (value / max) * plotHeight

  return <section className="space-y-2">
    <h2 className="text-lg font-semibold text-stone-900">Cash flow trend</h2>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full" role="img" aria-label="Monthly outflow and bank inflow by month">
      <line x1={PADDING_X} y1={HEIGHT - PADDING_BOTTOM} x2={WIDTH - PADDING_X} y2={HEIGHT - PADDING_BOTTOM} stroke="#e7e5e4" />
      {months.map((month, index) => {
        const center = PADDING_X + index * groupWidth + groupWidth / 2
        const outflowHeight = scale(month.outflow)
        const inflowHeight = scale(month.bankCredits)
        const outflowX = hasBankData ? center - barWidth - 2 : center - barWidth / 2
        return <g key={month.month}>
          <rect x={outflowX} y={HEIGHT - PADDING_BOTTOM - outflowHeight} width={barWidth} height={outflowHeight} fill="#047857" />
          {hasBankData && <rect x={center + 2} y={HEIGHT - PADDING_BOTTOM - inflowHeight} width={barWidth} height={inflowHeight} fill="#a8a29e" />}
          <text x={center} y={HEIGHT - PADDING_BOTTOM + 16} textAnchor="middle" fontSize="10" fill="#78716c">{month.month.slice(5)}</text>
        </g>
      })}
    </svg>
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-stone-600">
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-700" />Outflow (documents + bank debits)</span>
      {hasBankData && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-stone-400" />Bank inflow (credits)</span>}
    </div>
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-stone-500">
      {months.map((month) => <span key={month.month}>{month.month}: net {formatMoney(month.net)}</span>)}
    </div>
    <p className="text-xs text-stone-500">
      Document totals and bank-statement amounts are independent series here and may double-count the same payment —
      reconciling them is what bank matching is for.
    </p>
  </section>
}
