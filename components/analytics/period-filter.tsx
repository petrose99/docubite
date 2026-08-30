import Link from "next/link"

const PILLS: { value: "30d" | "90d" | "12m"; label: string }[] = [
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "12m", label: "12 months" },
]

/** Pills for the three rolling windows plus a plain GET date-range form — the review queue's
 * STATUS_TABS idiom, reused for a period instead of a status. No JS, no date-picker dependency:
 * two native `<input type="date">`s and a submit are enough, and it survives a bookmark or a
 * back button the same way the tabs do. */
export function PeriodFilter({ workspaceId, current, from, to }: { workspaceId: string; current: string; from: string; to: string }) {
  const base = `/workspaces/${workspaceId}`
  return <div className="flex flex-wrap items-center gap-3">
    <nav className="flex gap-1 rounded-md border bg-stone-50 p-0.5">
      {PILLS.map((pill) => {
        const active = current === pill.value
        return <Link key={pill.value} href={pill.value === "12m" ? base : `${base}?period=${pill.value}`}
          className={`rounded px-3 py-1 text-sm font-medium ${active ? "bg-white text-emerald-800 shadow-sm" : "text-stone-500 hover:text-stone-800"}`}>
          {pill.label}
        </Link>
      })}
    </nav>
    <form className="flex items-center gap-1.5 text-sm" action={base} method="get">
      <input type="date" name="from" defaultValue={from} className="rounded-md border border-stone-300 px-2 py-1 text-sm" />
      <span className="text-stone-400">to</span>
      <input type="date" name="to" defaultValue={to} className="rounded-md border border-stone-300 px-2 py-1 text-sm" />
      <button type="submit" className="rounded-md border bg-white px-2.5 py-1 font-medium text-stone-700 hover:bg-stone-50">Apply</button>
    </form>
  </div>
}
