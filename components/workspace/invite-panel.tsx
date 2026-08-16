"use client"

import { InvitationsTable, PendingInvitation } from "@/components/workspace/invitations-table"
import { MemberInvite } from "@/components/workspace/member-invite"
import { useState } from "react"

export type InviteLink = { email: string; url: string }

/** Owns the one copyable-link slot shared by the invite form and the pending-invitations table.
 *
 * Both can mint a token for the same address, and minting a new one deletes the old row — so if
 * each kept its own link the owner would end up looking at two URLs for one invitee, only the
 * newer of which still works. One piece of state, last writer wins. */
export function InvitePanel({ workspaceId, invitations }: { workspaceId: string; invitations: PendingInvitation[] }) {
  const [link, setLink] = useState<InviteLink | null>(null)

  return <div className="space-y-4">
    <MemberInvite workspaceId={workspaceId} onLink={setLink} />
    <InvitationsTable workspaceId={workspaceId} invitations={invitations} onLink={setLink} />
    {link && <div className="rounded-lg border border-dashed bg-muted/50 p-3">
      <p className="text-xs font-medium text-foreground">Email is not configured — send this link to {link.email} yourself</p>
      <code className="mt-1.5 block break-all rounded bg-background px-2 py-1.5 font-mono text-xs text-muted-foreground">{link.url}</code>
    </div>}
  </div>
}
