"use client"

import { createWorkspaceAction } from "@/app/(app)/workspaces/[workspaceId]/workspace-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Check, ChevronsUpDown, Plus } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

export type SwitchableWorkspace = { id: string; name: string; kind: string; role?: string }

/** The sidebar's workspace chip. Replaces both the old `<select>` (which navigated to the
 * long-gone /sheet route) and the plain link list the sidebar rendered underneath the nav. */
export function WorkspaceSwitcher({ workspaces, workspaceId }: { workspaces: SwitchableWorkspace[]; workspaceId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [upgrade, setUpgrade] = useState(false)
  const [pending, startTransition] = useTransition()
  const current = workspaces.find((workspace) => workspace.id === workspaceId)

  const create = () => startTransition(async () => {
    const result = await createWorkspaceAction(name)
    if (!result.success || !result.data) {
      // The one error worth handling in place rather than as a toast: the plan simply does not
      // allow another workspace, so offer the way out instead of the failure.
      if (result.error?.includes("team workspaces require upgrade")) { setUpgrade(true); return }
      toast.error(result.error || "Could not create the workspace")
      return
    }
    toast.success("Workspace created")
    setOpen(false); setCreating(false); setName("")
    router.push(`/workspaces/${result.data.workspaceId}`)
  })

  return <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setCreating(false); setUpgrade(false) } }}>
    <PopoverTrigger asChild>
      <button type="button" className="flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-stone-200 hover:bg-white" aria-label="Switch workspace">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-stone-200/80 text-[11px] font-bold text-stone-600">
          {(current?.name || "W").trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-stone-800">{current?.name || "Workspace"}</span>
          <span className="block truncate text-xs text-stone-400">{current?.kind === "team" ? "Team workspace" : "Personal workspace"}</span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-stone-400" />
      </button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-64 p-1.5">
      <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-400">Workspaces</p>
      <ul className="max-h-64 overflow-y-auto">
        {workspaces.map((workspace) => <li key={workspace.id}>
          <Link href={`/workspaces/${workspace.id}`} onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-stone-700 hover:bg-stone-100">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-stone-100 text-[10px] font-bold text-stone-500">{workspace.name.trim().charAt(0).toUpperCase()}</span>
            <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
            {workspace.kind === "team" && <span className="shrink-0 text-[11px] text-stone-400">team</span>}
            <Check className={`h-3.5 w-3.5 shrink-0 text-primary ${workspace.id === workspaceId ? "" : "invisible"}`} />
          </Link>
        </li>)}
      </ul>

      <div className="mt-1.5 border-t pt-1.5">
        {upgrade
          ? <Link href={`/workspaces/${workspaceId}/settings/billing`} onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-primary hover:bg-stone-100">
              Your plan allows one workspace — upgrade
            </Link>
          : creating
            ? <form className="flex gap-1.5" onSubmit={(event) => { event.preventDefault(); create() }}>
                <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Workspace name" autoFocus required className="h-8" />
                <Button type="submit" size="sm" disabled={pending}>{pending ? "…" : "Add"}</Button>
              </form>
            : <button type="button" onClick={() => setCreating(true)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100">
                <Plus className="h-3.5 w-3.5 text-stone-400" />New workspace
              </button>}
      </div>
    </PopoverContent>
  </Popover>
}
