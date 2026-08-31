"use client"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Check, ChevronsUpDown, Plus } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

export type SwitchableWorkspace = { id: string; name: string; kind: string; role?: string }

/** The sidebar's workspace chip. Replaces both the old `<select>` (which navigated to the
 * long-gone /sheet route) and the plain link list the sidebar rendered underneath the nav. */
export function WorkspaceSwitcher({ workspaces, workspaceId }: { workspaces: SwitchableWorkspace[]; workspaceId: string }) {
  const [open, setOpen] = useState(false)
  const current = workspaces.find((workspace) => workspace.id === workspaceId)

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" className="flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-slate-200 hover:bg-white" aria-label="Switch workspace">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-200/80 text-[11px] font-bold text-slate-600">
          {(current?.name || "W").trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-800">{current?.name || "Workspace"}</span>
          <span className="block truncate text-xs text-slate-400">{current?.kind === "team" ? "Team workspace" : "Personal workspace"}</span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-64 p-1.5">
      <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Workspaces</p>
      <ul className="max-h-64 overflow-y-auto">
        {workspaces.map((workspace) => <li key={workspace.id}>
          <Link href={`/workspaces/${workspace.id}`} onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-bold text-slate-500">{workspace.name.trim().charAt(0).toUpperCase()}</span>
            <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
            {workspace.kind === "team" && <span className="shrink-0 text-[11px] text-slate-400">team</span>}
            <Check className={`h-3.5 w-3.5 shrink-0 text-primary ${workspace.id === workspaceId ? "" : "invisible"}`} />
          </Link>
        </li>)}
      </ul>

      <div className="mt-1.5 border-t pt-1.5">
        <Link href="/workspaces/create" onClick={() => setOpen(false)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100">
          <Plus className="h-3.5 w-3.5 text-slate-400" />New workspace
        </Link>
      </div>
    </PopoverContent>
  </Popover>
}
