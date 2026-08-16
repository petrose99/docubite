"use client"

import { resendWorkspaceInvitationAction, revokeWorkspaceInvitationAction } from "@/app/(app)/workspaces/[workspaceId]/workspace-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Mail } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

export type PendingInvitation = { id: string; email: string; role: string; expiresAt: string }

const expiryLabel = (expiresAt: string) => {
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  return days <= 1 ? "expires today" : `expires in ${days} days`
}

/** `onLink` writes into the single copyable-link slot InvitePanel owns — a resend mints a new
 * token and deletes the old row, so any link shown by the invite form is dead the moment this
 * fires and must be replaced rather than sat next to. */
export function InvitationsTable({ workspaceId, invitations, onLink }: { workspaceId: string; invitations: PendingInvitation[]; onLink: (link: { email: string; url: string } | null) => void }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [revoking, setRevoking] = useState<PendingInvitation | null>(null)

  const resend = (invitation: PendingInvitation) => startTransition(async () => {
    const result = await resendWorkspaceInvitationAction(workspaceId, invitation.email, invitation.role)
    if (!result.success || !result.data) { toast.error(result.error || "Could not resend the invitation"); return }
    onLink(result.data.emailed ? null : { email: invitation.email, url: result.data.inviteUrl })
    toast.success(result.data.emailed ? `Invitation re-sent to ${invitation.email}` : "New invitation link created — the previous link no longer works")
    router.refresh()
  })

  const revoke = () => startTransition(async () => {
    if (!revoking) return
    const result = await revokeWorkspaceInvitationAction(workspaceId, revoking.id)
    if (!result.success) { toast.error(result.error || "Could not revoke the invitation"); return }
    // The revoked address's link, if one is on screen, is now dead too.
    onLink(null)
    toast.success("Invitation revoked")
    setRevoking(null)
    router.refresh()
  })

  if (!invitations.length) return <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">No pending invitations.</p>

  return <div className="space-y-3">
    <ul className="divide-y overflow-hidden rounded-lg border">
      {invitations.map((invitation) => {
        const expired = new Date(invitation.expiresAt) < new Date()
        return <li key={invitation.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-card px-4 py-3 text-sm transition-colors hover:bg-muted/40">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Mail className="h-4 w-4" /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-foreground">{invitation.email}</span>
            <span className="block text-xs capitalize text-muted-foreground">Invited as {invitation.role}</span>
          </span>
          {expired ? <Badge variant="destructive">Expired</Badge> : <span className="text-xs text-muted-foreground">{expiryLabel(invitation.expiresAt)}</span>}
          <span className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" disabled={pending} onClick={() => resend(invitation)}>Resend</Button>
            <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" disabled={pending} onClick={() => setRevoking(invitation)}>Revoke</Button>
          </span>
        </li>
      })}
    </ul>

    <ConfirmDialog open={Boolean(revoking)} destructive busy={pending}
      title={`Revoke the invitation for ${revoking?.email}?`}
      description="Their invitation link stops working immediately."
      confirmLabel="Revoke" onConfirm={revoke} onCancel={() => setRevoking(null)} />
  </div>
}
