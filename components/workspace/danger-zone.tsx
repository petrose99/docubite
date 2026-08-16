"use client"

import { deleteWorkspaceAction, leaveWorkspaceAction, renameWorkspaceAction } from "@/app/(app)/workspaces/[workspaceId]/workspace-actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TriangleAlert } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

/** Both destructive paths end in a hard navigation rather than router.push: the membership this
 * whole segment is rendered behind has just gone, so the layout's redirect and (chrome)'s
 * requireWorkspaceRole throw would race a soft transition. Same reasoning as the sign-out. */
const escapeToWorkspaceList = () => { window.location.href = "/workspaces" }

export function WorkspaceDangerZone({ workspaceId, workspaceName, workspaceKind, viewerRole }: {
  workspaceId: string
  workspaceName: string
  workspaceKind: string
  viewerRole: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(workspaceName)
  const [deleting, setDeleting] = useState(false)
  const [confirmName, setConfirmName] = useState("")
  const [leaving, setLeaving] = useState(false)
  const owner = viewerRole === "owner"

  if (!owner) {
    return <Card>
      <CardHeader>
        <CardTitle>Leave workspace</CardTitle>
        <CardDescription>You lose access to every file in {workspaceName}. An owner would have to invite you back.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="destructive" disabled={pending || workspaceKind === "personal"} onClick={() => setLeaving(true)}>Leave workspace</Button>
        {workspaceKind === "personal" && <p className="mt-2 text-sm text-muted-foreground">A personal workspace cannot be left.</p>}
        <ConfirmDialog open={leaving} destructive busy={pending} title="Leave this workspace?" description="You lose access to its files immediately." confirmLabel="Leave"
          onCancel={() => setLeaving(false)}
          onConfirm={() => startTransition(async () => {
            const result = await leaveWorkspaceAction(workspaceId)
            if (!result.success) { toast.error(result.error || "Could not leave the workspace"); return }
            escapeToWorkspaceList()
          })} />
      </CardContent>
    </Card>
  }

  return <div className="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>Workspace name</CardTitle>
        <CardDescription>Shown in the sidebar switcher and on every invitation.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-wrap gap-2" onSubmit={(event) => {
          event.preventDefault()
          startTransition(async () => {
            const result = await renameWorkspaceAction(workspaceId, name)
            if (!result.success) { toast.error(result.error || "Could not rename the workspace"); return }
            toast.success("Workspace renamed")
            router.refresh()
          })
        }}>
          <Input value={name} onChange={(event) => setName(event.target.value)} className="max-w-xs" minLength={2} maxLength={80} required />
          <Button type="submit" disabled={pending || name.trim() === workspaceName}>{pending ? "Saving…" : "Save"}</Button>
        </form>
      </CardContent>
    </Card>

    <Card className="border-destructive/30">
      <CardHeader className="flex-row items-start gap-3 space-y-0 rounded-t-xl border-b border-destructive/20 bg-destructive/5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive"><TriangleAlert className="h-4 w-4" /></span>
        <span className="space-y-1">
          <CardTitle className="text-destructive">Delete workspace</CardTitle>
          <CardDescription>Permanently deletes every file, document, uploaded source and extraction sheet in {workspaceName}. This cannot be undone.</CardDescription>
        </span>
      </CardHeader>
      <CardContent className="pt-6">
        <Button type="button" variant="destructive" disabled={pending} onClick={() => { setConfirmName(""); setDeleting(true) }}>Delete this workspace</Button>
      </CardContent>
    </Card>

    {/* ConfirmDialog cannot collect text, and this is the one confirmation worth making the
        user type out — so it uses the plain Dialog with its own confirm field. */}
    <Dialog open={deleting} title="Delete this workspace?" description={`Type “${workspaceName}” to confirm. Every document and uploaded file is deleted permanently.`} onClose={() => setDeleting(false)}>
      <form className="space-y-3 px-5 py-4" onSubmit={(event) => {
        event.preventDefault()
        startTransition(async () => {
          const result = await deleteWorkspaceAction(workspaceId)
          if (!result.success) { toast.error(result.error || "Could not delete the workspace"); return }
          escapeToWorkspaceList()
        })
      }}>
        <Label htmlFor="confirm-workspace-name">Workspace name</Label>
        <Input id="confirm-workspace-name" value={confirmName} onChange={(event) => setConfirmName(event.target.value)} autoComplete="off" />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setDeleting(false)}>Cancel</Button>
          <Button type="submit" variant="destructive" disabled={pending || confirmName.trim() !== workspaceName}>{pending ? "Deleting…" : "Delete permanently"}</Button>
        </div>
      </form>
    </Dialog>
  </div>
}
