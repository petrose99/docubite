"use client"

import { createAutomationRuleAction } from "@/app/(app)/workspaces/[workspaceId]/automation-actions"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

export function AutomationRuleForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const submit = async (formData: FormData) => {
    setPending(true)
    try {
      const result = await createAutomationRuleAction(workspaceId, formData)
      if (!result.success) { toast.error(result.error || "Could not create the rule"); return }
      toast.success("Rule created")
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false) }
  }

  return <form action={submit} className="grid gap-3 rounded border p-4 sm:grid-cols-2">
    <div className="sm:col-span-2">
      <label className="block text-xs font-medium text-stone-500">Rule name (optional)</label>
      <input name="name" className="mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm" placeholder="e.g. Meridian Print" />
    </div>
    <div>
      <label className="block text-xs font-medium text-stone-500">Match</label>
      <select name="matcherType" className="mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm">
        <option value="exact">Supplier is exactly</option>
        <option value="contains">Supplier contains</option>
      </select>
    </div>
    <div>
      <label className="block text-xs font-medium text-stone-500">Supplier text</label>
      <input name="matcherValue" required className="mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm" placeholder="Meridian Print Ltd" />
    </div>
    <div>
      <label className="block text-xs font-medium text-stone-500">Account to assign</label>
      <input name="account" required className="mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm" placeholder="6000 — Printing" />
    </div>
    <label className="flex items-center gap-2 self-end text-sm">
      <input type="checkbox" name="requireReview" /> Always send matches to review
    </label>
    <div className="sm:col-span-2">
      <button type="submit" disabled={pending} className="rounded-md bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Add rule</button>
    </div>
  </form>
}
