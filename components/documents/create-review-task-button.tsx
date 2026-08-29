"use client"

import { createReviewTaskAction } from "@/app/(app)/workspaces/[workspaceId]/review-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

/** The affordance flagged as missing in every recent Dext-parity handoff: `createReviewTaskAction`
 * has existed since WP10 with nothing on the document page calling it (the review-inbox's own
 * empty-state copy has said "...or when someone adds one manually from a document's page" the
 * whole time, pointing at a button that didn't exist). One free-text detail field — the same
 * "manual" reason every other caller of `createReviewTask` defaults to — and a submit button. */
export function CreateReviewTaskButton({ workspaceId, documentId }: { workspaceId: string; documentId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState("")
  const [busy, setBusy] = useState(false)

  if (!open) {
    return <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>Send for review</Button>
  }

  const submit = async () => {
    setBusy(true)
    try {
      const result = await createReviewTaskAction(workspaceId, documentId, detail)
      if (!result.success || !result.data) { toast.error(result.error || "Could not create a review task"); setBusy(false); return }
      toast.success("Sent for review")
      router.push(`/workspaces/${workspaceId}/review/${result.data.id}`)
    } catch {
      toast.error("Could not reach the server")
      setBusy(false)
    }
  }

  return <div className="flex items-center gap-2">
    <Input
      value={detail}
      onChange={(event) => setDetail(event.target.value)}
      placeholder="Why does this need review? (optional)"
      className="h-8 max-w-xs text-sm"
      disabled={busy}
    />
    <Button type="button" size="sm" disabled={busy} onClick={() => void submit()}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
    </Button>
    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
  </div>
}
