"use client"

import { setAutomationRuleActiveAction } from "@/app/(app)/workspaces/[workspaceId]/automation-actions"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

export function AutomationRuleActiveToggle({ workspaceId, ruleId, active }: { workspaceId: string; ruleId: string; active: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const toggle = async () => {
    setPending(true)
    try {
      const result = await setAutomationRuleActiveAction(workspaceId, ruleId, !active)
      if (!result.success) { toast.error(result.error || "Could not update the rule"); return }
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false) }
  }

  return <button type="button" disabled={pending} onClick={() => void toggle()}
    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${active ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-500"}`}>
    {active ? "Active" : "Inactive"}
  </button>
}
