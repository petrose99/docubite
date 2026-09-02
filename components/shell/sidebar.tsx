"use client"

import { AccountMenu } from "@/components/shell/account-menu"
import { SwitchableWorkspace, WorkspaceSwitcher } from "@/components/workspace/switcher"
import { BiteMark } from "@/components/marketing/logo"
import { MODULES } from "@/lib/modules"
import { BarChart3, ClipboardCheck, Files, HeartPulse, History, Landmark, ListChecks, Mic, Settings } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

/** Maps a ModuleDefinition.navItems[].icon string (lib/modules) to the lucide component it names.
 * A string in the registry rather than the component itself keeps lib/modules free of a React/UI
 * dependency — it's read by server code (capabilities, seeds) that has no business importing icons.
 * Settings-tagged module items (Rules, Tax, Approvals) don't render here at all — they show up in
 * components/shell/settings-nav.tsx instead, next to the settings pages they actually lead to.
 * The review-queue module's own "Review" entry is filtered out below the same way: the pipeline's
 * Approvals tab is that surface now, and /review/[reviewTaskId] itself stays reachable from the
 * document detail page's "Send for review" / "view review task" link — it just no longer needs a
 * standing rail entry of its own. Expenses is filtered out the same way — still reachable at its
 * own route, just no longer a standing rail entry. */
const ICONS: Record<string, typeof Files> = {
  inbox: ClipboardCheck,
  mic: Mic,
  "heart-pulse": HeartPulse,
}

/** Lido's left rail. The repo had no sidebar component at all — the nav was inline in two
 * layout files — so this is the one place the app's top-level destinations are declared.
 *
 * It steps aside for the spreadsheet. Lido gives an open file the whole window and navigates
 * back out through the file bar's "← Files" rather than a persistent rail, and a grid is the
 * one screen where 224px of chrome costs real columns.
 *
 * Home, Files, module entries, then a single Settings link — the ~10 individual settings links
 * that used to sit here flat now live as tabs on the settings pages themselves (SettingsNav), so
 * this rail doesn't scroll. Module nav entries (Dictate) come from
 * `enabledModuleKeys` — the workspace's resolved capability set (lib/modules/capabilities.ts) —
 * rather than ad-hoc per-feature booleans. */
export function Sidebar({ workspaceId, workspaces, user, enabledModuleKeys, accountingEnabled = false, pipelineReviewCount = 0 }: {
  workspaceId: string
  workspaces: SwitchableWorkspace[]
  user: { name: string; email: string }
  /** Every module key currently enabled for this workspace (getWorkspaceCapabilities(...).enabled),
   * used to build the nav entries each module registers via ModuleDefinition.navItems. */
  enabledModuleKeys: string[]
  /** config.integrations.bigcapital.enabled — a deployment-level gate, not a per-workspace module,
   * since it depends on the encryption key being configured at all rather than anything a workspace
   * owner toggles. */
  accountingEnabled?: boolean
  /** counts.to_review from countDocumentsByStage — how many documents are waiting on a person right
   * now. Surfaced as a badge on the Pipeline entry so "something needs you" is visible from every
   * page, not just after clicking into Pipeline's own To review tab. */
  pipelineReviewCount?: number
}) {
  const pathname = usePathname()
  if (pathname.endsWith("/sheet")) return null

  const base = `/workspaces/${workspaceId}`
  const enabled = new Set(enabledModuleKeys)
  const moduleWorkItems = MODULES
    .filter((module) => enabled.has(module.key))
    .flatMap((module) => module.navItems ?? [])
    .filter((item) => !item.href.startsWith("settings/") && item.href !== "review" && item.href !== "expenses" && item.href !== "dictation")
    .map((item) => ({ href: `${base}/${item.href}`, label: item.label, icon: ICONS[item.icon] ?? Files, exact: false }))

  // Home is every workspace's unconditional first entry — exact-matched so it doesn't stay lit on
  // every page under it, unlike Files (which stays lit through a file's hub and sheet too).
  // Pipeline is the new primary upload→review surface (replacing folder-scoped navigation as the
  // main destination); Files is demoted below it — still available for the rare case someone
  // wants the underlying spreadsheet/ingestion-container view, but no longer where the app points
  // first. See the pipeline redesign plan, Phases 2 & 6.
  //
  // Grouped into Workspace / Modules / Settings sections, mirroring the merged nav from the
  // enterprise restyle — module entries (Dictate, Accounting) sit apart from the fixed Home/
  // Pipeline/Files trio since they come and go per workspace, and Settings is its own section of
  // one so it doesn't read as just another workspace destination.
  const workItems = [
    { href: base, label: "Dashboard", icon: BarChart3, exact: true },
    { href: `${base}/pipeline`, label: "Extraction", icon: ListChecks, exact: false, badge: pipelineReviewCount > 0 ? pipelineReviewCount : undefined },
    { href: `${base}/files`, label: "Files", icon: Files, exact: false },
    { href: `${base}/activity`, label: "Activity", icon: History, exact: false },
  ]
  const moduleItems = [
    ...moduleWorkItems,
    ...(accountingEnabled ? [{ href: `${base}/accounting`, label: "Accounting", icon: Landmark, exact: false }] : []),
  ]
  const settingsItems = [{ href: `${base}/settings/workspace`, label: "Settings", icon: Settings, exact: false }]

  const navLink = (item: { href: string; label: string; icon: typeof Files; exact: boolean; badge?: number }) => {
    // Non-exact entries stay lit while you're inside a page under them — Settings while you're on
    // any settings leaf, a module item while you're on its own sub-pages.
    const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`) || (item.label === "Settings" && pathname.startsWith(`${base}/settings`))
    return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${active ? "relative bg-white text-emerald-800 shadow-[0_1px_2px_rgba(15,23,42,0.07),inset_0_0_0_1px_rgba(4,120,87,0.10)]" : "text-slate-600 hover:bg-[rgba(148,163,184,0.16)] hover:text-slate-900"}`}>
      {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-emerald-700" />}
      <item.icon className="h-4 w-4 shrink-0" />{item.label}
      {item.badge != null && <span className="ml-auto flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-indigo-600 px-1 text-[11px] font-bold text-white">{item.badge}</span>}
    </Link>
  }

  const sectionLabel = (label: string) => <div className="px-2.5 pb-1 pt-3 text-[10.5px] font-bold uppercase tracking-[0.06em] text-slate-400 first:pt-0">{label}</div>

  return <aside className="hidden w-[236px] shrink-0 flex-col gap-0.5 border-r border-[#e6ebf1] bg-gradient-to-b from-[#f4f7f9] to-[#eef2f6] px-3 py-3.5 md:flex">
    <Link href={base} className="flex items-center gap-2 px-1.5 py-1">
      <BiteMark className="h-7 w-7 shrink-0" />
      <span className="truncate text-sm font-bold font-display text-slate-900">DocuBite</span>
    </Link>

    <div className="mb-1 mt-2"><WorkspaceSwitcher workspaces={workspaces} workspaceId={workspaceId} /></div>

    <nav className="flex flex-col">
      {sectionLabel("Workspace")}
      <div className="space-y-0.5">{workItems.map(navLink)}</div>

      {moduleItems.length > 0 && <>
        {sectionLabel("Modules")}
        <div className="space-y-0.5">{moduleItems.map(navLink)}</div>
      </>}

      {sectionLabel("Settings")}
      <div className="space-y-0.5">{settingsItems.map(navLink)}</div>
    </nav>

    <div className="mt-auto pt-3">
      <AccountMenu name={user.name} email={user.email} />
    </div>
  </aside>
}
