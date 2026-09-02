"use client"

import { BarChart3, History, ListChecks, MoreHorizontal, Table2 } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

export function MobileTabBar({ workspaceId, pipelineReviewCount = 0 }: {
  workspaceId: string
  pipelineReviewCount?: number
}) {
  const pathname = usePathname()
  if (pathname.endsWith("/sheet")) return null

  const base = `/workspaces/${workspaceId}`
  const tabs = [
    { href: base, label: "Dashboard", icon: BarChart3, exact: true },
    { href: `${base}/pipeline`, label: "Extraction", icon: ListChecks, exact: false, badge: pipelineReviewCount > 0 ? pipelineReviewCount : undefined },
    { href: `${base}/files`, label: "Sheets", icon: Table2, exact: false },
    { href: `${base}/activity`, label: "Activity", icon: History, exact: false },
    { href: `${base}/settings/workspace`, label: "More", icon: MoreHorizontal, exact: false },
  ]

  return <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 items-center border-t border-[#eef2f6] bg-[rgba(255,255,255,0.94)] px-2 pb-5 pt-2 backdrop-blur-[10px] md:hidden">
    {tabs.map((tab) => {
      const active = tab.exact
        ? pathname === tab.href
        : pathname === tab.href || pathname.startsWith(`${tab.href}/`) || (tab.label === "More" && pathname.startsWith(`${base}/settings`))
      return <Link key={tab.href} href={tab.href}
        className={`relative flex flex-col items-center gap-1 p-1 text-[10.5px] ${active ? "font-semibold text-emerald-700" : "font-medium text-slate-400"}`}>
        <tab.icon className="h-[21px] w-[21px]" />
        {tab.badge != null && <span className="absolute left-[calc(50%+8px)] top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white">{tab.badge}</span>}
        {tab.label}
      </Link>
    })}
  </nav>
}
