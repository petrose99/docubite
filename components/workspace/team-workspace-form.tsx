"use client"

import { createWorkspaceAction } from "@/app/(app)/workspaces/[workspaceId]/workspace-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

export function TeamWorkspaceForm() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return <form className="flex flex-col gap-4" action={(formData) => startTransition(async () => {
    const result = await createWorkspaceAction(String(formData.get("name") || ""))
    if (!result.success || !result.data) {
      setError(result.error || "Could not create the workspace")
      return
    }
    setError(null)
    toast.success("Workspace created")
    router.push(`/workspaces/${result.data.workspaceId}`)
  })}>
    <div className="flex flex-wrap items-center gap-2">
      <Input name="name" placeholder="Team workspace name" className="max-w-xs" required />
      <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create workspace"}</Button>
    </div>
    {error && <p className="text-sm text-destructive">{error}</p>}
  </form>
}
