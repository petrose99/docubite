import { REGISTRY } from "@/lib/health/registry"
import type { CheckDefinition, HealthCategory } from "@/lib/health/types"
import Link from "next/link"

const CATEGORY_LABELS: Record<HealthCategory, string> = {
  pipeline: "Pipeline",
  cleanup: "Cleanup",
  tax: "Tax",
  activity: "Activity",
}

// Registration order in lib/health/registry.ts already groups pipeline checks first, then
// cleanup, then tax, then activity (see that file's own phase comments) — this fixed order just
// makes that grouping explicit and stable regardless of any future reordering of REGISTRY itself.
const CATEGORY_ORDER: HealthCategory[] = ["pipeline", "cleanup", "tax", "activity"]

/** Data Health's own left sub-nav — separate from the app's main Sidebar (components/shell/
 * sidebar.tsx), one level down, the same way Dext's real Data Health product groups every check
 * under small bold category labels with an individual nav link per check. Selection is a plain
 * `?check=<code>` search param on the health route (mirrors components/pipeline/stage-tabs.tsx's
 * `?stage=` links) rather than client-side state, so a link here is shareable/bookmarkable and the
 * detail pane is just a normal server-rendered navigation, not a client tab switch. `activeCheck`
 * null means the Overview view (no `?check=` param at all). */
export function HealthSidebarNav({ workspaceId, activeCheck, countsByCheck = {} }: {
  workspaceId: string
  activeCheck: string | null
  /** Open-finding count per check code, shown as a small badge next to its name — omitted (or a
   * code missing from the map) renders no badge, same as a zero count would. */
  countsByCheck?: Record<string, number>
}) {
  const base = `/workspaces/${workspaceId}/health`
  const byCategory = new Map<HealthCategory, CheckDefinition[]>()
  for (const category of CATEGORY_ORDER) byCategory.set(category, [])
  // showInNav defaults true — most checks opt out (lib/health/registry.ts's `hidden` wrapper) so
  // the sidebar only lists the handful someone can actually act on. A hidden check still runs and
  // still counts toward the score; it just has no link here.
  for (const check of REGISTRY) if (check.showInNav !== false) byCategory.get(check.category)?.push(check)

  // Same active-state visual language as components/shell/sidebar.tsx's own navLink (white pill +
  // emerald text when active, slate hover otherwise) — reused rather than invented so the sub-nav
  // reads as part of the same app, not a bolted-on widget.
  const navLink = (href: string, label: string, isActive: boolean, count?: number) =>
    <Link key={href} href={href} aria-current={isActive ? "page" : undefined}
      className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${isActive ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-900"}`}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {!!count && <span className={`shrink-0 rounded-full px-1.5 text-xs font-semibold tabular-nums ${isActive ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{count}</span>}
    </Link>

  const sectionLabel = (label: string) =>
    <div className="px-2.5 pb-1 pt-3 text-[10.5px] font-bold uppercase tracking-wide text-slate-400 first:pt-0">{label}</div>

  return <aside className="flex w-60 shrink-0 flex-col gap-0.5 rounded-lg border bg-slate-100 px-2.5 py-3">
    {sectionLabel("Data health")}
    <div className="space-y-0.5">{navLink(base, "Overview", activeCheck === null)}</div>

    {/* No collapse/accordion here: with the nav filtered down to only the checks someone can
     * actually act on (lib/health/registry.ts's `hidden` wrapper), the whole list is short enough
     * to show flat — an accordion earned its keep against 21 items, not 6. */}
    {CATEGORY_ORDER.map((category) => {
      const checks = byCategory.get(category) ?? []
      if (checks.length === 0) return null
      return <div key={category}>
        {sectionLabel(CATEGORY_LABELS[category])}
        <div className="space-y-0.5">
          {checks.map((check) => navLink(`${base}?check=${check.code}`, check.name, activeCheck === check.code, countsByCheck[check.code]))}
        </div>
      </div>
    })}
  </aside>
}
