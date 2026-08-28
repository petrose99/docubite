"use client"

import { createInitialWorkspaceAction } from "@/app/(app)/workspaces/new/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { IndustryPicker } from "@/components/workspace/industry-picker"
import type { Industry } from "@/types/industry"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

/** The brand-new user's first choice: pick an industry, confirm the workspace name, go. No
 * "not sure" toggle beyond General itself being one of the five cards — General already reads as
 * the escape hatch (core modules only, nothing industry-specific to second-guess). */
export function NewWorkspaceForm({ defaultName }: { defaultName: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [industry, setIndustry] = useState<Industry>("general")

  return <form className="space-y-6" action={(formData) => startTransition(async () => {
    const result = await createInitialWorkspaceAction(String(formData.get("name") || ""), industry)
    if (!result.success || !result.data) { setError(result.error || "Could not set up your workspace"); return }
    router.push(`/workspaces/${result.data.workspaceId}/files`)
  })}>
    <IndustryPicker value={industry} onChange={setIndustry} disabled={pending} />
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Input name="name" defaultValue={defaultName} className="max-w-xs" required />
      <Button type="submit" disabled={pending}>{pending ? "Setting up…" : "Continue"}</Button>
    </div>
    {error && <p className="text-center text-sm text-destructive">{error}</p>}
  </form>
}
