"use client"

import { inviteWorkspaceMemberAction } from "@/app/(app)/workspaces/[workspaceId]/workspace-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { UserPlus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

/** `onLink` is called only when the send was skipped or failed; with Resend configured the
 * invitee already has the link in their inbox and surfacing it here just invites it into a chat
 * log. The link itself is rendered by InvitePanel, which owns the single slot both this form and
 * the invitations table write to. */
export function MemberInvite({ workspaceId, onLink }: { workspaceId: string; onLink: (link: { email: string; url: string } | null) => void }) {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("member")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return <div className="space-y-3">
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      setError(null)
      startTransition(async () => {
        const result = await inviteWorkspaceMemberAction(workspaceId, data)
        if (!result.success || !result.data) { setError(result.error || "Could not create invitation"); return }
        onLink(result.data.emailed ? null : { email, url: result.data.inviteUrl })
        toast.success(result.data.emailed ? `Invitation sent to ${email}` : "Invitation created — email is not configured, so share the link below")
        setEmail("")
        router.refresh()
      })
    }}>
      <Input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@company.com" required className="sm:flex-1" />
      <NativeSelect name="role" aria-label="Role" className="sm:w-32" value={role} onChange={(event) => setRole(event.target.value)}>
        <option value="member">Member</option>
        <option value="owner">Owner</option>
      </NativeSelect>
      <Button type="submit" disabled={pending}><UserPlus />{pending ? "Inviting…" : "Send invite"}</Button>
    </form>
    {error && <p className="text-sm text-destructive">{error}</p>}
  </div>
}
