"use client"

import { setWorkspaceAiAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { useState } from "react"
import { toast } from "sonner"

export function WorkspaceAiToggle({ workspaceId, enabled }: { workspaceId: string; enabled: boolean }) {
  const [checked, setChecked] = useState(enabled)
  const [pending, setPending] = useState(false)

  const change = async (next: boolean) => {
    setChecked(next)
    setPending(true)
    try {
      const result = await setWorkspaceAiAction(workspaceId, next)
      if (!result.success) { setChecked(!next); toast.error(result.error || "Could not change the AI setting"); return }
      toast.success(next ? "AI extraction enabled" : "AI extraction disabled")
    } catch {
      setChecked(!next)
      toast.error("Could not reach the server — the AI setting was not changed")
    } finally { setPending(false) }
  }

  return <label className="flex items-center justify-between gap-4 rounded border p-4"><span><span className="block font-medium">AI extraction</span><span className="text-sm text-muted-foreground">When enabled, the platform vision model extracts your template fields. Disabled workspaces can still receive and review documents manually.</span></span><input aria-label="Enable AI extraction" type="checkbox" checked={checked} disabled={pending} onChange={(event) => void change(event.target.checked)} /></label>
}
