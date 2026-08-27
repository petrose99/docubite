"use client"

import { setTaxRegionAction } from "@/app/(app)/workspaces/[workspaceId]/tax-actions"
import type { TaxRegionCode } from "@/lib/tax/types"
import { useState } from "react"
import { toast } from "sonner"

export function TaxRegionPicker({ workspaceId, regions, current }: {
  workspaceId: string
  regions: { code: TaxRegionCode; name: string; currency: string }[]
  current: TaxRegionCode | null
}) {
  const [selected, setSelected] = useState(current ?? regions[0]?.code)
  const [pending, setPending] = useState(false)

  const save = async () => {
    if (!selected) return
    setPending(true)
    try {
      const result = await setTaxRegionAction(workspaceId, selected)
      if (!result.success) { toast.error(result.error || "Could not change the tax region"); return }
      toast.success(`Tax region set to ${regions.find((region) => region.code === selected)?.name || selected}`)
    } catch {
      toast.error("Could not reach the server — the setting was not changed")
    } finally { setPending(false) }
  }

  return <div className="flex flex-wrap items-center gap-3">
    <select
      aria-label="Tax region"
      className="rounded-md border px-3 py-2 text-sm"
      value={selected}
      disabled={pending}
      onChange={(event) => setSelected(event.target.value as TaxRegionCode)}
    >
      {regions.map((region) => <option key={region.code} value={region.code}>{region.name} ({region.currency})</option>)}
    </select>
    <button
      type="button"
      disabled={pending || selected === current}
      onClick={() => void save()}
      className="rounded-md bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
    >
      Save
    </button>
  </div>
}
