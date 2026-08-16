"use client"

import { Loader2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

/** Drives the pre-existing /api/stripe/checkout and /api/stripe/portal routes, which until now
 * had no entry point in the UI at all. */
export function UpgradePlanButton({ workspaceId, plans, hasBillingProfile }: {
  workspaceId: string
  plans: Array<{ code: string; name: string; price: number }>
  hasBillingProfile: boolean
}) {
  const [code, setCode] = useState(plans[0]?.code ?? "")
  const [busy, setBusy] = useState(false)

  const upgrade = async () => {
    if (!code) return
    setBusy(true)
    try {
      const response = await fetch("/api/stripe/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, code }) })
      const payload = await response.json().catch(() => null) as { url?: string; error?: string } | null
      if (!response.ok || !payload?.url) { toast.error(payload?.error || "Could not start checkout"); return }
      window.location.href = payload.url
    } catch {
      toast.error("Could not reach the server")
    } finally { setBusy(false) }
  }

  return <div className="flex flex-wrap items-center gap-2">
    {plans.length > 0 && <>
      <select aria-label="Plan to upgrade to" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={code} onChange={(event) => setCode(event.target.value)}>
        {plans.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}{plan.price >= 0 ? ` — $${plan.price}/mo` : ""}</option>)}
      </select>
      <button type="button" className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50" disabled={busy} onClick={() => void upgrade()}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}Upgrade plan
      </button>
    </>}
    {hasBillingProfile && <a className="inline-flex items-center rounded-md border px-3.5 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50" href={`/api/stripe/portal?workspaceId=${workspaceId}`}>Open billing portal</a>}
    {!plans.length && !hasBillingProfile && <p className="text-sm text-muted-foreground">Stripe is not configured for this deployment.</p>}
  </div>
}
