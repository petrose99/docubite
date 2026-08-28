"use client"

import { setWorkspaceIndustryAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { IndustryPicker } from "@/components/workspace/industry-picker"
import type { Industry } from "@/types/industry"
import { useState } from "react"
import { toast } from "sonner"

/** Locked, not disabled: once a workspace has files this returns product_mode_locked instead of
 * changing anything, and the toggle reflects that back rather than silently doing nothing on
 * click — the same optimistic-then-revert shape as WorkspaceHipaaModeToggle.
 *
 * The full 5-industry card set (IndustryPicker), not just finance/healthcare — this used to be a
 * 2-way toggle before the module registry existed; now it's the same picker /workspaces/new and
 * the team-creation form use, so there is exactly one place industry copy/chips are described. */
export function WorkspaceIndustryToggle({ workspaceId, mode }: { workspaceId: string; mode: Industry }) {
  const [current, setCurrent] = useState(mode)
  const [pending, setPending] = useState(false)

  const change = async (next: Industry) => {
    if (next === current || pending) return
    setCurrent(next)
    setPending(true)
    try {
      const result = await setWorkspaceIndustryAction(workspaceId, next)
      if (!result.success) { setCurrent(mode); toast.error(result.error || "Could not change the industry"); return }
      toast.success(`Switched to ${next}`)
    } catch {
      setCurrent(mode)
      toast.error("Could not reach the server — the setting was not changed")
    } finally { setPending(false) }
  }

  return <div className="space-y-3 rounded border p-4">
    <div>
      <span className="block font-medium">Industry</span>
      <span className="text-sm text-muted-foreground">What this workspace is set up for. Locked once the workspace has any files.</span>
    </div>
    <IndustryPicker value={current} onChange={(next) => void change(next)} disabled={pending} />
  </div>
}
