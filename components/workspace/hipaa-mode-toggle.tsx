"use client"

import { setWorkspaceHipaaModeAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { useState } from "react"
import { toast } from "sonner"

export function WorkspaceHipaaModeToggle({ workspaceId, enabled }: { workspaceId: string; enabled: boolean }) {
  const [checked, setChecked] = useState(enabled)
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const apply = async (next: boolean) => {
    setChecked(next)
    setPending(true)
    try {
      const result = await setWorkspaceHipaaModeAction(workspaceId, next)
      if (!result.success) { setChecked(!next); toast.error(result.error || "Could not change the HIPAA mode setting"); return }
      toast.success(next ? "HIPAA mode enabled — link sharing turned off for every file" : "HIPAA mode disabled")
    } catch {
      setChecked(!next)
      toast.error("Could not reach the server — the setting was not changed")
    } finally { setPending(false) }
  }

  // Turning it on is a one-click affordance for the same reason the danger zone below asks for a
  // confirmation on delete: it force-revokes every existing link in the workspace, and that
  // deserves a beat before it happens rather than a stray click.
  const change = (next: boolean) => {
    if (next) { setConfirming(true); return }
    void apply(false)
  }

  return <div className="space-y-3 rounded border p-4">
    <label className="flex items-center justify-between gap-4">
      <span>
        <span className="block font-medium">HIPAA mode</span>
        <span className="text-sm text-muted-foreground">Turns off link sharing for every file in this workspace — only workspace members and people you invite by email can open a file. Use this for workspaces that handle protected health information.</span>
      </span>
      <input aria-label="Enable HIPAA mode" type="checkbox" checked={checked} disabled={pending} onChange={(event) => change(event.target.checked)} />
    </label>
    {confirming && <div className="flex items-center justify-between gap-3 rounded bg-amber-50 p-3 text-sm text-amber-900">
      <span>This immediately revokes every file&apos;s share link in this workspace. Continue?</span>
      <span className="flex shrink-0 gap-2">
        <button type="button" className="rounded-md border px-2.5 py-1 font-medium hover:bg-white" onClick={() => setConfirming(false)}>Cancel</button>
        <button type="button" className="rounded-md bg-amber-700 px-2.5 py-1 font-semibold text-white hover:bg-amber-800" onClick={() => { setConfirming(false); void apply(true) }}>Enable</button>
      </span>
    </div>}
  </div>
}
