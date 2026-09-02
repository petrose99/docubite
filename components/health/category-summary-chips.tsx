import type { HealthCategory } from "@/lib/health/types"

const CATEGORY_LABELS: Record<HealthCategory, string> = {
  pipeline: "Pipeline",
  cleanup: "Cleanup",
  tax: "Tax",
  activity: "Activity",
}
const CATEGORY_ORDER: HealthCategory[] = ["pipeline", "cleanup", "tax", "activity"]

/** Overview's summary strip: one small stat tile per category with its open-finding count, same
 * visual weight as the workspace dashboard's own stat-tile grid (app/(app)/workspaces/
 * [workspaceId]/page.tsx's `stats`) so Overview reads as a real dashboard section rather than a
 * leftover from the old tabbed layout. Activity's "count" is really "how many of its checks have
 * something to say" (submission volume, automation rate, etc. are metrics, not issues), which is
 * still a meaningful number to show alongside the other three. */
export function CategorySummaryChips({ countsByCategory }: { countsByCategory: Record<HealthCategory, number> }) {
  return <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
    {CATEGORY_ORDER.map((category) => <div key={category} className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="text-[26px] font-extrabold tracking-tight text-slate-900">{countsByCategory[category] ?? 0}</div>
      <div className="mt-0.5 text-[13px] text-slate-500">{CATEGORY_LABELS[category]}</div>
    </div>)}
  </div>
}
