"use client"

import { addAllowedSenderAction, removeAllowedSenderAction } from "@/app/(app)/workspaces/[workspaceId]/inbound-email-actions"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

export function InboundEmailAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { toast.error("Could not copy to clipboard") }
  }
  return <div className="flex items-center gap-2">
    <code className="rounded bg-slate-100 px-2 py-1 text-sm">{address}</code>
    <button type="button" onClick={() => void copy()} className="text-xs font-medium text-emerald-700 hover:underline">{copied ? "Copied" : "Copy"}</button>
  </div>
}

export function AddAllowedSenderForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const submit = async (formData: FormData) => {
    setPending(true)
    try {
      const result = await addAllowedSenderAction(workspaceId, formData)
      if (!result.success) { toast.error(result.error || "Could not add that sender"); return }
      toast.success("Sender added")
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false) }
  }

  return <form action={submit} className="flex items-end gap-2">
    <div className="flex-1">
      <label className="block text-xs font-medium text-slate-500">Email address or @domain</label>
      <input name="pattern" required className="mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm" placeholder="bookkeeper@firm.com or @firm.com" />
    </div>
    <button type="submit" disabled={pending} className="rounded-md bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Add</button>
  </form>
}

export function RemoveAllowedSenderButton({ workspaceId, id }: { workspaceId: string; id: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const remove = async () => {
    setPending(true)
    try {
      const result = await removeAllowedSenderAction(workspaceId, id)
      if (!result.success) { toast.error(result.error || "Could not remove that sender"); return }
      router.refresh()
    } catch {
      toast.error("Could not reach the server")
    } finally { setPending(false) }
  }

  return <button type="button" disabled={pending} onClick={() => void remove()} className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50">Remove</button>
}
