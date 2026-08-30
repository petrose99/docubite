"use client"

import { createWorkspaceAction } from "@/app/(app)/workspaces/[workspaceId]/workspace-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { IndustryPicker } from "@/components/workspace/industry-picker"
import type { Industry } from "@/types/industry"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

/** Industry has to be chosen here, at creation — not something you set on an empty workspace
 * afterward. A workspace gets its first file the instant it's created (createWorkspaceForUser),
 * so by the time this form's redirect lands anywhere, setIndustry's "locked once it has
 * content" rule has already engaged. There is no follow-up screen for this. */
export function TeamWorkspaceForm({ billingWorkspaceId }: { billingWorkspaceId?: string } = {}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [upgrade, setUpgrade] = useState(false)
  const [industry, setIndustry] = useState<Industry>("general")

  return <form className="flex flex-col gap-4" action={(formData) => startTransition(async () => {
    const result = await createWorkspaceAction(String(formData.get("name") || ""), industry)
    if (!result.success || !result.data) {
      // The one error worth handling in place rather than as a toast: the plan simply does not
      // allow another workspace, so offer the way out instead of the failure. Matched against
      // action-helpers.ts's BILLING_MESSAGES text (createWorkspaceAction already ran the raw
      // "team_workspaces_require_upgrade" code through errorMessage() before this ever sees it).
      if (result.error?.includes("Team workspaces need a plan")) { setError(null); setUpgrade(true); return }
      setUpgrade(false); setError(result.error || "Could not create the workspace")
      return
    }
    setError(null); setUpgrade(false)
    toast.success("Workspace created")
    router.push(`/workspaces/${result.data.workspaceId}`)
  })}>
    <div className="flex flex-wrap items-center gap-2">
      <Input name="name" placeholder="Team workspace name" className="max-w-xs" required />
      <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create workspace"}</Button>
    </div>
    <IndustryPicker value={industry} onChange={setIndustry} disabled={pending} />
    {error && <p className="text-sm text-destructive">{error}</p>}
    {upgrade && <p className="text-sm text-destructive">
      Your plan allows one workspace — <Link href={billingWorkspaceId ? `/workspaces/${billingWorkspaceId}/settings/billing` : "/workspaces"} className="font-medium text-primary underline">upgrade from billing settings</Link>.
    </p>}
  </form>
}
