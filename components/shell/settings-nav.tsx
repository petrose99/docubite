"use client"

import { MODULES } from "@/lib/modules"
import { Blocks, CheckCircle2, CreditCard, FileBarChart, History, Mail, Percent, Settings, ShieldCheck, Users, Wand2, Webhook } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

const ICONS: Record<string, typeof Settings> = {
  workflow: Wand2,
  percent: Percent,
  "check-circle": CheckCircle2,
}

/** The settings sub-nav: every destination the sidebar used to list as its own flat link, now
 * tabs across the top of a settings page instead — the sidebar collapses them to a single
 * "Settings" entry (components/shell/sidebar.tsx). Same destinations, reorganized navigation,
 * no new pages. Rendered by the (chrome) layout only for settings/* routes. */
export function SettingsNav({ workspaceId, enabledModuleKeys, integrationsEnabled = false }: {
  workspaceId: string
  enabledModuleKeys: string[]
  integrationsEnabled?: boolean
}) {
  const pathname = usePathname()
  const base = `/workspaces/${workspaceId}/settings`
  if (!pathname.startsWith(base)) return null
  const enabled = new Set(enabledModuleKeys)
  const moduleItems = MODULES
    .filter((module) => enabled.has(module.key))
    .flatMap((module) => module.navItems ?? [])
    .filter((item) => item.href.startsWith("settings/"))
    .map((item) => ({ href: `/workspaces/${workspaceId}/${item.href}`, label: item.label, icon: ICONS[item.icon] ?? Settings }))

  const items = [
    { href: `${base}/workspace`, label: "Workspace", icon: Users },
    { href: `${base}/modules`, label: "Modules", icon: Blocks },
    ...moduleItems,
    { href: `${base}/templates`, label: "Templates", icon: Settings },
    { href: `${base}/reports`, label: "Reports", icon: FileBarChart },
    { href: `${base}/activity`, label: "Activity", icon: History },
    { href: `${base}/email`, label: "Email intake", icon: Mail },
    { href: `${base}/security`, label: "Security", icon: ShieldCheck },
    { href: `${base}/billing`, label: "Billing & Usage", icon: CreditCard },
    ...(integrationsEnabled ? [{ href: `${base}/integrations`, label: "Integrations", icon: Webhook }] : []),
  ]

  return <nav className="mb-6 flex flex-wrap gap-1 border-b pb-3">
    {items.map((item) => {
      const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
      return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
        className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${active ? "bg-stone-100 text-emerald-800" : "text-stone-600 hover:bg-stone-100/60 hover:text-stone-900"}`}>
        <item.icon className="h-4 w-4 shrink-0" />{item.label}
      </Link>
    })}
  </nav>
}
