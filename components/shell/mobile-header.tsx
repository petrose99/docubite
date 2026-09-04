"use client"

import { BiteMark } from "@/components/marketing/logo"
import { SwitchableWorkspace, WorkspaceSwitcher } from "@/components/workspace/switcher"
import Link from "next/link"
import { usePathname } from "next/navigation"

export function MobileHeader({ workspaceId, workspaces, user }: {
  workspaceId: string
  workspaces: SwitchableWorkspace[]
  user: { name: string; email: string }
}) {
  const pathname = usePathname()
  if (pathname.endsWith("/sheet") || pathname.includes("/documents/")) return null
  const initial = (user.name || user.email).trim().charAt(0).toUpperCase() || "?"

  return <header className="flex shrink-0 items-center gap-2.5 border-b border-[#eef2f6] bg-[rgba(250,251,252,0.9)] px-4 pb-2.5 pt-3 backdrop-blur-[10px] md:hidden">
    <Link href={`/workspaces/${workspaceId}`} className="shrink-0">
      <BiteMark className="h-7 w-7" />
    </Link>
    <div className="min-w-0 flex-1">
      <WorkspaceSwitcher workspaces={workspaces} workspaceId={workspaceId} />
    </div>
    <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-emerald-700 text-[13px] font-bold text-white">{initial}</span>
  </header>
}
