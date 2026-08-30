"use client"

import { createInitialWorkspaceAction } from "@/app/(app)/workspaces/new/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

/** The brand-new user's first workspace: confirm the workspace name and go. The app is
 * finance-only, so there is no industry to choose. */
export function NewWorkspaceForm({ defaultName }: { defaultName: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return <form className="space-y-6" action={(formData) => startTransition(async () => {
    const result = await createInitialWorkspaceAction(String(formData.get("name") || ""))
    if (!result.success || !result.data) { setError(result.error || "Could not set up your workspace"); return }
    router.push(`/workspaces/${result.data.workspaceId}`)
  })}>
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Input name="name" defaultValue={defaultName} className="max-w-xs" required />
      <Button type="submit" disabled={pending}>{pending ? "Setting up…" : "Continue"}</Button>
    </div>
    {error && <p className="text-center text-sm text-destructive">{error}</p>}
  </form>
}
