"use client"

import { disableModuleAction, enableModuleAction, requestModuleAction } from "@/app/(app)/workspaces/[workspaceId]/module-actions"
import { Button } from "@/components/ui/button"
import { useState, useTransition } from "react"
import { toast } from "sonner"

type Props = {
  workspaceId: string
  moduleKey: string
  name: string
  description: string
  /** "always" rows never render this component's controls (the catalog page filters them into
   * "Included" with no toggle at all) — this only ever renders for "default" or "optional". */
  kind: "default" | "optional"
  enabled: boolean
  owner: boolean
  activation: "enable" | "request"
  requestedBy: { name: string; email: string } | null
}

/** One row of the modules catalog. Owners see a working toggle (default: on/off; optional with
 * activation "enable": off/on). A member on an "optional"/"request" module they can't toggle gets
 * a Request button instead — optimistic, since the request itself grants nothing to roll back. */
export function ModuleRow({ workspaceId, moduleKey, name, description, kind, enabled, owner, activation, requestedBy }: Props) {
  const [checked, setChecked] = useState(enabled)
  const [requested, setRequested] = useState(Boolean(requestedBy) && !enabled)
  const [pending, startTransition] = useTransition()

  const toggle = () => {
    if (!owner) return
    const next = !checked
    setChecked(next)
    startTransition(async () => {
      const result = next ? await enableModuleAction(workspaceId, moduleKey) : await disableModuleAction(workspaceId, moduleKey)
      if (!result.success) { setChecked(!next); toast.error(result.error || "Could not change that module") }
    })
  }

  const request = () => {
    setRequested(true)
    startTransition(async () => {
      const result = await requestModuleAction(workspaceId, moduleKey)
      if (!result.success) { setRequested(false); toast.error(result.error || "Could not send that request") }
      else toast.success("Request sent to the workspace owner")
    })
  }

  return <div className="flex items-start justify-between gap-4 border-b py-3 last:border-0">
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span className="font-medium text-stone-900">{name}</span>
        {kind === "optional" && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">Optional</span>}
        {requestedBy && !enabled && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Requested by {requestedBy.name}</span>}
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
    <div className="shrink-0">
      {owner
        ? (kind === "default" || activation === "enable"
          ? <button type="button" disabled={pending} onClick={toggle}
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${checked ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-500"}`}>
              {checked ? "On" : "Off"}
            </button>
          : <span className="text-xs text-stone-500">Request-only</span>)
        : (activation === "request"
          ? <Button size="sm" variant="outline" disabled={pending || requested} onClick={request}>{requested ? "Requested" : "Request"}</Button>
          : <span className="text-xs text-stone-500">{checked ? "Enabled" : "Disabled"}</span>)}
    </div>
  </div>
}
