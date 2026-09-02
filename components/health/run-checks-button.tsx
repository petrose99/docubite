"use client"

import { runHealthChecksAction } from "@/app/(app)/workspaces/[workspaceId]/health-actions"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

/** Phase A has no scheduled job wired up yet — this manual re-run is the only way the checks
 * (and the score snapshot) run at all. Reloads the page's server data on success so newly
 * (un)resolved findings and the refreshed score show up immediately. */
export function RunChecksButton({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  return <Button type="button" variant="outline" size="sm" disabled={running} onClick={async () => {
    setRunning(true)
    try {
      const result = await runHealthChecksAction(workspaceId)
      if (!result.success) throw new Error(result.error)
      toast.success("Health checks ran")
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not run health checks")
    } finally {
      setRunning(false)
    }
  }}>
    <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
    {running ? "Running…" : "Run checks now"}
  </Button>
}
