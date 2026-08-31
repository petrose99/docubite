"use client"

import { deleteDocumentsAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Loader2, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

export function DeleteDocumentButton({ workspaceId, fileId, documentId, filename }: { workspaceId: string; fileId: string; documentId: string; filename: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    setBusy(true)
    try {
      const result = await deleteDocumentsAction(workspaceId, fileId, [documentId])
      if (!result.success) return void toast.error(result.error || "Delete failed")
      toast.success(`${filename} deleted`)
      router.push(`/workspaces/${workspaceId}/pipeline`)
      router.refresh()
    } catch {
      toast.error("Could not reach the server — nothing was deleted")
    } finally { setBusy(false) }
  }

  return <>
    <Button type="button" variant="outline" size="sm" className="text-red-600 hover:bg-red-50 hover:text-red-700" disabled={busy} onClick={() => setOpen(true)}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Delete
    </Button>
    <ConfirmDialog
      open={open}
      destructive
      busy={busy}
      title="Delete this document?"
      description={`${filename} and every row extracted from it will be removed, along with the stored source file. This cannot be undone.`}
      confirmLabel={busy ? "Deleting…" : "Delete"}
      onConfirm={() => void remove()}
      onCancel={() => setOpen(false)} />
  </>
}
