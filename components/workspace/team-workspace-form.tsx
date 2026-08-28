"use client"

import { createWorkspaceAction } from "@/app/(app)/workspaces/[workspaceId]/workspace-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Industry } from "@/types/industry"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

const MODES: { value: Industry; label: string; description: string }[] = [
  { value: "finance", label: "Finance", description: "Invoices, receipts, and bank statements." },
  { value: "healthcare", label: "Healthcare", description: "Dictation-first reporting. Required for HIPAA mode." },
]

/** Mode has to be chosen here, at creation — not something you set on an empty workspace
 * afterward. A workspace gets its first file the instant it's created (createWorkspaceForUser),
 * so by the time this form's redirect lands anywhere, setIndustry's "locked once it has
 * content" rule has already engaged. There is no follow-up screen for this. */
export function TeamWorkspaceForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Industry>("finance")

  return <form className="flex flex-col gap-3" action={(formData) => startTransition(async () => {
    const result = await createWorkspaceAction(String(formData.get("name") || ""), mode)
    if (!result.success || !result.data) { setError(result.error || "Could not create the workspace"); return }
    setError(null)
    toast.success("Team workspace created")
    router.push(`/workspaces/${result.data.workspaceId}/files`)
  })}>
    <div className="flex flex-wrap gap-2">
      <Input name="name" placeholder="Team workspace name" className="max-w-xs" required />
      <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create workspace"}</Button>
    </div>
    <div className="flex gap-2">
      {MODES.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setMode(option.value)}
          aria-pressed={mode === option.value}
          className={`flex-1 max-w-xs rounded-md border px-3 py-2 text-left text-sm transition-colors ${mode === option.value ? "border-emerald-700 bg-emerald-50" : "hover:bg-stone-50"}`}
        >
          <span className="block font-semibold">{option.label}</span>
          <span className="block text-xs text-muted-foreground">{option.description}</span>
        </button>
      ))}
    </div>
    {error && <p className="text-sm text-destructive">{error}</p>}
  </form>
}
