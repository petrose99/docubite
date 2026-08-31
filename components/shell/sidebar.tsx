"use client"

import { AccountMenu } from "@/components/shell/account-menu"
import { SwitchableWorkspace, WorkspaceSwitcher } from "@/components/workspace/switcher"
import { BiteMark } from "@/components/marketing/logo"
import { MODULES } from "@/lib/modules"
import { BarChart3, ClipboardCheck, Files, ListChecks, Mic, Settings } from "lucide-react"
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
export function Sidebar({ workspaceId, workspaces, user, enabledModuleKeys }: {
  workspaceId: string
  workspaces: SwitchableWorkspace[]
  user: { name: string; email: string }
  /** Every module key currently enabled for this workspace (getWorkspaceCapabilities(...).enabled),
   * used to build the nav entries each module registers via ModuleDefinition.navItems. */
  enabledModuleKeys: string[]
}) {
  const pathname = usePathname()
  if (pathname.endsWith("/sheet")) return null

  const base = `/workspaces/${workspaceId}`
  const enabled = new Set(enabledModuleKeys)
  const moduleWorkItems = MODULES
    .filter((module) => enabled.has(module.key))
    .flatMap((module) => module.navItems ?? [])
    .filter((item) => !item.href.startsWith("settings/") && item.href !== "review" && item.href !== "expenses")
    .map((item) => ({ href: `${base}/${item.href}`, label: item.label, icon: ICONS[item.icon] ?? Files, exact: false }))

  // Home is every workspace's unconditional first entry — exact-matched so it doesn't stay lit on
  // every page under it, unlike Files (which stays lit through a file's hub and sheet too).
  // Pipeline is the new primary upload→review surface (replacing folder-scoped navigation as the
  // main destination); Files is demoted below it — still available for the rare case someone
  // wants the underlying spreadsheet/ingestion-container view, but no longer where the app points
  // first. See the pipeline redesign plan, Phases 2 & 6.
  const workItems = [
    { href: base, label: "Home", icon: BarChart3, exact: true },
    { href: `${base}/pipeline`, label: "Pipeline", icon: ListChecks, exact: false },
    { href: `${base}/files`, label: "Files", icon: Files, exact: false },
    ...moduleWorkItems,
    { href: `${base}/settings/workspace`, label: "Settings", icon: Settings, exact: false },
  ]

  const navLink = (item: { href: string; label: string; icon: typeof Files; exact: boolean }) => {
    // Non-exact entries stay lit while you're inside a page under them — Settings while you're on
    // any settings leaf, a module item while you're on its own sub-pages.
    const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`) || (item.label === "Settings" && pathname.startsWith(`${base}/settings`))
    return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${active ? "bg-white text-emerald-800 shadow-sm" : "text-stone-600 hover:bg-stone-200/60 hover:text-stone-900"}`}>
      <item.icon className="h-4 w-4 shrink-0" />{item.label}
    </Link>
  }

  return <aside className="flex w-56 shrink-0 flex-col gap-1 border-r bg-stone-50 px-2 py-3">
    <Link href={base} className="flex items-center gap-2 px-2 py-1">
      <BiteMark className="h-7 w-7 shrink-0" />
      <span className="truncate text-sm font-bold text-stone-900">DocuBite</span>
    </Link>

    <div className="mb-2"><WorkspaceSwitcher workspaces={workspaces} workspaceId={workspaceId} /></div>

    <nav className="space-y-0.5">
      {workItems.map(navLink)}
    </nav>

    <div className="mt-auto pt-3">
      <AccountMenu name={user.name} email={user.email} />
    </div>
  </aside>
}
