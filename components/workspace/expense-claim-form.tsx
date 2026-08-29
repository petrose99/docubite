"use client"

import { createExpenseClaimAction } from "@/app/(app)/workspaces/[workspaceId]/expense-claim-actions"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

export function ExpenseClaimForm({ workspaceId, receipts }: {
  workspaceId: string
  receipts: { id: string; filename: string; merchant: string; total: number | null }[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const submit = async (formData: FormData) => {
    setPending(true)
    try {
      const result = await createExpenseClaimAction(workspaceId, formData)
      if (!result.success) { toast.error(result.error || "Could not create the claim"); return }
      toast.success("Claim created as a draft")
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false) }
  }

  return <form action={submit} className="space-y-3">
    <div>
      <label className="block text-xs font-medium text-stone-500">Title (optional)</label>
      <input name="title" className="mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm" placeholder="e.g. Client trip, August" />
    </div>
    <div>
      <label className="block text-xs font-medium text-stone-500">Receipts</label>
      <div className="mt-1.5 max-h-56 space-y-1.5 overflow-y-auto rounded border p-2">
        {receipts.map((receipt) => (
          <label key={receipt.id} className="flex items-center justify-between gap-3 rounded px-1.5 py-1 text-sm hover:bg-stone-50">
            <span className="flex items-center gap-2">
              <input type="checkbox" name="documentIds" value={receipt.id} />
              <span>{receipt.merchant}</span>
              <span className="text-xs text-stone-400">{receipt.filename}</span>
            </span>
            {receipt.total !== null && <span className="shrink-0 font-mono text-xs text-stone-600">{receipt.total.toFixed(2)}</span>}
          </label>
        ))}
      </div>
    </div>
    <button type="submit" disabled={pending} className="rounded-md bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Create claim</button>
  </form>
}
