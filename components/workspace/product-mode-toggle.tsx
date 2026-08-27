"use client"

import { setWorkspaceProductModeAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import type { ProductMode } from "@/types/product-mode"
import { useState } from "react"
import { toast } from "sonner"

const OPTIONS: { value: ProductMode; label: string; description: string }[] = [
  { value: "accounting", label: "Accounting", description: "Invoices, receipts, and bank statements for firms and finance teams." },
  { value: "clinical", label: "Clinical", description: "Dictation-first reporting. Required for HIPAA mode." },
]

/** Locked, not disabled: once a workspace has files this returns product_mode_locked instead of
 * changing anything, and the toggle reflects that back rather than silently doing nothing on
 * click — the same optimistic-then-revert shape as WorkspaceHipaaModeToggle. */
export function WorkspaceProductModeToggle({ workspaceId, mode }: { workspaceId: string; mode: ProductMode }) {
  const [current, setCurrent] = useState(mode)
  const [pending, setPending] = useState(false)

  const change = async (next: ProductMode) => {
    if (next === current || pending) return
    setCurrent(next)
    setPending(true)
    try {
      const result = await setWorkspaceProductModeAction(workspaceId, next)
      if (!result.success) { setCurrent(mode); toast.error(result.error || "Could not change the product mode"); return }
      toast.success(`Switched to ${next} mode`)
    } catch {
      setCurrent(mode)
      toast.error("Could not reach the server — the setting was not changed")
    } finally { setPending(false) }
  }

  return <div className="space-y-3 rounded border p-4">
    <div>
      <span className="block font-medium">Product mode</span>
      <span className="text-sm text-muted-foreground">What this workspace is set up for. Locked once the workspace has any files.</span>
    </div>
    <div className="flex gap-2">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={pending}
          onClick={() => void change(option.value)}
          aria-pressed={current === option.value}
          className={`flex-1 rounded-md border px-3 py-2 text-left text-sm transition-colors ${current === option.value ? "border-emerald-700 bg-emerald-50" : "hover:bg-stone-50"}`}
        >
          <span className="block font-semibold">{option.label}</span>
          <span className="block text-xs text-muted-foreground">{option.description}</span>
        </button>
      ))}
    </div>
  </div>
}
