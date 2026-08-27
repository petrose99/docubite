"use client"

import { setAsrExternalAllowedAction } from "@/app/admin-next/baa/actions"
import { useState } from "react"
import { toast } from "sonner"

export function BaaCoverageToggle({ workspaceId, allowed }: { workspaceId: string; allowed: boolean }) {
  const [checked, setChecked] = useState(allowed)
  const [pending, setPending] = useState(false)

  const change = async (next: boolean) => {
    setChecked(next)
    setPending(true)
    try {
      const result = await setAsrExternalAllowedAction(workspaceId, next)
      if (!result.success) { setChecked(!next); toast.error(result.error || "Could not change BAA coverage"); return }
      toast.success(next ? "BAA coverage confirmed — dictation is now available" : "BAA coverage revoked — dictation is now blocked")
    } catch {
      setChecked(!next)
      toast.error("Could not reach the server — the setting was not changed")
    } finally { setPending(false) }
  }

  return <label className="flex items-center gap-2">
    <input aria-label="BAA coverage confirmed" type="checkbox" checked={checked} disabled={pending} onChange={(event) => void change(event.target.checked)} />
    <span className="text-sm">{checked ? "Confirmed" : "Pending"}</span>
  </label>
}
