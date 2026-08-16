"use client"

import { changeWorkspaceMemberRoleAction, leaveWorkspaceAction, removeWorkspaceMemberAction, transferWorkspaceOwnershipAction } from "@/app/(app)/workspaces/[workspaceId]/workspace-actions"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { NativeSelect } from "@/components/ui/native-select"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

export type WorkspaceMemberRow = { userId: string; name: string; email: string; role: string }

type Pending = { kind: "remove" | "transfer" | "leave"; member: WorkspaceMemberRow }

/** The same initial chip the sidebar's account menu uses, so a person looks like the same person
 * in both places. */
const Avatar = ({ label }: { label: string }) => (
  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
    {label.trim().charAt(0).toUpperCase() || "?"}
  </span>
)

const RoleTag = ({ role }: { role: string }) => (
  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${role === "owner" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{role}</span>
)

/** Built from <ul>/flex rather than a table primitive: the design system has no table, select or
 * dropdown-menu component, and the only Radix packages installed are label, popover and slot. */
export function MembersTable({ workspaceId, workspaceKind, members, viewerId, viewerRole }: {
  workspaceId: string
  workspaceKind: string
  members: WorkspaceMemberRow[]
  viewerId: string
  viewerRole: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirm, setConfirm] = useState<Pending | null>(null)
  const owner = viewerRole === "owner"
  const owners = members.filter((member) => member.role === "owner").length

  const run = (action: () => Promise<{ success: boolean; error?: string }>, success: string, onDone?: () => void) => startTransition(async () => {
    const result = await action()
    if (!result.success) { toast.error(result.error || "Something went wrong"); return }
    toast.success(success)
    setConfirm(null)
    if (onDone) onDone(); else router.refresh()
  })

  // Leaving removes the membership this page is rendered behind, so the segment layout would
  // redirect and (chrome)/layout.tsx would throw mid-transition. A hard navigation instead.
  const leave = () => run(() => leaveWorkspaceAction(workspaceId), "You left the workspace", () => { window.location.href = "/workspaces" })

  const confirmProps = confirm?.kind === "remove"
    ? { title: `Remove ${confirm.member.name || confirm.member.email}?`, description: "They lose access to every file in this workspace, including files shared with them by email.", confirmLabel: "Remove", onConfirm: () => run(() => removeWorkspaceMemberAction(workspaceId, confirm.member.userId), "Member removed") }
    : confirm?.kind === "transfer"
      ? { title: `Make ${confirm.member.name || confirm.member.email} the owner?`, description: "They gain full control of this workspace, including billing. You become a regular member.", confirmLabel: "Transfer ownership", onConfirm: () => run(() => transferWorkspaceOwnershipAction(workspaceId, confirm.member.userId), "Ownership transferred") }
      : { title: "Leave this workspace?", description: "You lose access to its files. An owner would have to invite you back.", confirmLabel: "Leave", onConfirm: leave }

  return <>
    <ul className="divide-y overflow-hidden rounded-lg border">
      {members.map((member) => {
        const self = member.userId === viewerId
        // The sole owner may not be demoted — the model refuses it, so do not offer it either.
        const lockedRole = !owner || (member.role === "owner" && owners <= 1)
        return <li key={member.userId} className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-card px-4 py-3 text-sm transition-colors hover:bg-muted/40">
          <Avatar label={member.name || member.email} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-foreground">{member.name || member.email}{self && <span className="ml-1.5 text-xs font-normal text-muted-foreground">you</span>}</span>
            {member.name && <span className="block truncate text-xs text-muted-foreground">{member.email}</span>}
          </span>

          {lockedRole
            ? <RoleTag role={member.role} />
            : <NativeSelect aria-label={`Role for ${member.email}`} className="h-8 capitalize" value={member.role} disabled={pending}
                onChange={(event) => run(() => changeWorkspaceMemberRoleAction(workspaceId, member.userId, event.target.value), "Role updated")}>
                <option value="owner">Owner</option>
                <option value="member">Member</option>
              </NativeSelect>}

          {self
            // leaveWorkspace refuses a personal workspace outright, so do not offer a button
            // whose only outcome is an error toast.
            ? workspaceKind !== "personal" && <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" disabled={pending} onClick={() => setConfirm({ kind: "leave", member })}>Leave</Button>
            : owner && <span className="flex gap-1">
                {member.role !== "owner" && <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" disabled={pending} onClick={() => setConfirm({ kind: "transfer", member })}>Make owner</Button>}
                <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" disabled={pending} onClick={() => setConfirm({ kind: "remove", member })}>Remove</Button>
              </span>}
        </li>
      })}
    </ul>

    <ConfirmDialog open={Boolean(confirm)} destructive busy={pending} onCancel={() => setConfirm(null)} {...confirmProps} />
  </>
}
