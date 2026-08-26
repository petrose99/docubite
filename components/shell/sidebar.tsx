"use client"

import { AccountMenu } from "@/components/shell/account-menu"
import { SwitchableWorkspace, WorkspaceSwitcher } from "@/components/workspace/switcher"
import { BiteMark } from "@/components/marketing/logo"
import { CreditCard, Files, History, Mic, Settings, Users, Webhook } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

/** Lido's left rail. The repo had no sidebar component at all — the nav was inline in two
 * layout files — so this is the one place the app's top-level destinations are declared.
 *
 * It steps aside for the spreadsheet. Lido gives an open file the whole window and navigates
 * back out through the file bar's "← Files" rather than a persistent rail, and a grid is the
 * one screen where 224px of chrome costs real columns. */
export function Sidebar({ workspaceId, workspaces, user, dictationEnabled = false, integrationsEnabled = false }: {
  workspaceId: string
  workspaces: SwitchableWorkspace[]
  user: { name: string; email: string }
  /** The server's config.asr.enabled. Dictation gets a rail entry only where the server can
   * actually transcribe — a front door onto a page that answers "not configured" is worse than
   * no door. */
  dictationEnabled?: boolean
  /** The server's config.integrations.enabled. Same omit-if-unconfigured rule as dictation: no
   * Integrations entry unless the deployment has an encryption key to run webhooks/API keys. */
  integrationsEnabled?: boolean
}) {
  const pathname = usePathname()
  if (pathname.endsWith("/sheet")) return null

  const base = `/workspaces/${workspaceId}`
  const items = [
    { href: `${base}/files`, label: "Files", icon: Files },
    ...(dictationEnabled ? [{ href: `${base}/dictation`, label: "Dictation", icon: Mic }] : []),
    { href: `${base}/settings/workspace`, label: "Workspace", icon: Users },
    { href: `${base}/settings/activity`, label: "Activity", icon: History },
    { href: `${base}/settings/billing`, label: "Billing & Usage", icon: CreditCard },
    ...(integrationsEnabled ? [{ href: `${base}/settings/integrations`, label: "Integrations", icon: Webhook }] : []),
    { href: `${base}/settings/templates`, label: "Settings", icon: Settings },
  ]

  return <aside className="flex w-56 shrink-0 flex-col gap-1 border-r bg-stone-50 px-2 py-3">
    <Link href={`${base}/files`} className="flex items-center gap-2 px-2 py-1">
      <BiteMark className="h-7 w-7 shrink-0" />
      <span className="truncate text-sm font-bold text-stone-900">DocuBite</span>
    </Link>

    <div className="mb-2"><WorkspaceSwitcher workspaces={workspaces} workspaceId={workspaceId} /></div>

    <nav className="space-y-0.5">
      {items.map((item) => {
        // Files stays lit while you are inside a file's sheet, which lives under it.
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
          className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${active ? "bg-white text-emerald-800 shadow-sm" : "text-stone-600 hover:bg-stone-200/60 hover:text-stone-900"}`}>
          <item.icon className="h-4 w-4 shrink-0" />{item.label}
        </Link>
      })}
    </nav>

    <div className="mt-auto pt-3">
      <AccountMenu name={user.name} email={user.email} />
    </div>
  </aside>
}
