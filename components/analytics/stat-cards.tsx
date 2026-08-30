import Link from "next/link"

function StatCard({ label, value, hint, href, valueClassName }: { label: string; value: string; hint?: string; href?: string; valueClassName?: string }) {
  const className = `rounded border p-4 ${href ? "block transition-colors hover:border-emerald-400 hover:bg-emerald-50/40" : ""}`
  const inner = <>
    <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
    <div className={`mt-1 text-2xl font-bold ${valueClassName ?? "text-stone-900"}`}>{value}</div>
    {hint && <div className="mt-1 text-xs text-stone-500">{hint}</div>}
  </>
  return href ? <Link href={href} className={className}>{inner}</Link> : <div className={className}>{inner}</div>
}

/** The Overview page's four headline numbers, in the admin console's `Stat` idiom. "Awaiting
 * review" is the one card that's also a link — it's the one number here with somewhere obvious to
 * go to act on it. */
export function HeadlineCards({ workspaceId, totalSpend, totalOutstanding, netCashFlow, openReviewTasks, formatMoney }: {
  workspaceId: string
  totalSpend: number
  totalOutstanding: number
  netCashFlow: number
  openReviewTasks: number
  formatMoney: (value: number) => string
}) {
  return <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
    <StatCard label="Total spend" value={formatMoney(totalSpend)} hint="Costs and expenses this period" />
    <StatCard label="Total outstanding" value={formatMoney(totalOutstanding)} hint="Unpaid invoices" />
    <StatCard label="Net cash flow" value={formatMoney(netCashFlow)} hint="This period" valueClassName={netCashFlow < 0 ? "text-red-600" : undefined} />
    <StatCard label="Awaiting review" value={String(openReviewTasks)} hint="Open review tasks" href={`/workspaces/${workspaceId}/review`} />
  </div>
}
