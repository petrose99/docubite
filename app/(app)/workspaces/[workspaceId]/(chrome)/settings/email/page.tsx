import { AddAllowedSenderForm, InboundEmailAddress, RemoveAllowedSenderButton } from "@/components/settings/inbound-email-settings"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import config from "@/lib/config"
import { getCurrentUser } from "@/lib/auth"
import { ensureInboundEmailToken, listAllowedSenders } from "@/models/inbound-email"
import { requireWorkspaceRole } from "@/models/workspaces"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

/** WP1.4: surfaces the inbound-email address (previously dark — no UI existed even though the
 * route and token were built) and lets an owner widen the sender allowlist beyond "already a
 * workspace member". Not available for a healthcare workspace — see models/inbound-email.ts on
 * why unencrypted email is not an acceptable ePHI channel. */
export default async function InboundEmailSettingsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)
  const owner = membership.role === "owner"

  let token: string | null = null
  try {
    token = await ensureInboundEmailToken(workspaceId)
  } catch {
    notFound()
  }
  const senders = await listAllowedSenders(workspaceId)

  return <main className="space-y-6">
    <header>
      <h1 className="text-3xl font-bold">Email intake</h1>
      <p className="mt-1 text-muted-foreground">Forward or CC documents to this address and they&apos;ll be ingested the same way as an upload.</p>
    </header>

    <Card>
      <CardHeader>
        <CardTitle>Your inbound address</CardTitle>
        <CardDescription>{config.inboundEmail.enabled ? "Only mail from an allowed sender below is accepted." : "Not yet active on this deployment — the address is reserved for when it is."}</CardDescription>
      </CardHeader>
      <CardContent>
        <InboundEmailAddress address={`${token}@${config.inboundEmail.domain}`} />
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Allowed senders</CardTitle>
        <CardDescription>Every workspace member can already send. Add another address or a whole domain (e.g. @yourfirm.com) to widen that.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {owner && <AddAllowedSenderForm workspaceId={workspaceId} />}
        {!senders.length
          ? <p className="text-sm text-slate-500">No additional senders allowed yet.</p>
          : <ul className="divide-y">
              {senders.map((sender) => <li key={sender.id} className="flex items-center justify-between py-2 text-sm">
                <span>{sender.pattern}</span>
                {owner && <RemoveAllowedSenderButton workspaceId={workspaceId} id={sender.id} />}
              </li>)}
            </ul>}
      </CardContent>
    </Card>
  </main>
}
