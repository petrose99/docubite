import { IntegrationsManager } from "@/components/integrations/integrations-manager"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { WEBHOOK_EVENT_TYPES } from "@/lib/webhooks"
import {
  listWorkspaceApiKeys,
  listWorkspaceIntegrationConnections,
  listWorkspaceWebhookDeliveries,
  listWorkspaceWebhookEndpoints,
  workspaceIntegrationsPlanEnabled,
} from "@/models/integrations"
import { requireWorkspaceRole } from "@/models/workspaces"
import Link from "next/link"
import { notFound } from "next/navigation"

/** Outbound integrations: API keys + webhook endpoints + delivery history. Hard-gated on the
 * deployment having an encryption key (config.integrations.enabled) — with it off the sidebar entry
 * is omitted and this page 404s, so there is never a front door onto a feature the server can't run.
 * A second, softer gate is the plan: a workspace on a plan without integrations sees an upgrade note
 * instead of the management UI. */
export default async function IntegrationsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  if (!config.integrations.enabled) notFound()
  const { workspaceId } = await params
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)
  const planEnabled = await workspaceIntegrationsPlanEnabled(workspaceId)

  if (!planEnabled) {
    return <main className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Integrations</h1>
        <p className="mt-1 text-muted-foreground">Webhooks and the API let DocuBite push extracted data into the tools you already use.</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Available on a paid plan</CardTitle>
          <CardDescription>Upgrade to mint API keys and register webhook endpoints.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link className="font-medium text-emerald-700 hover:underline" href={`/workspaces/${workspaceId}/settings/billing`}>Go to Billing &amp; Usage</Link>
        </CardContent>
      </Card>
    </main>
  }

  const [apiKeys, endpoints, deliveries, connections] = await Promise.all([
    listWorkspaceApiKeys(workspaceId),
    listWorkspaceWebhookEndpoints(workspaceId),
    listWorkspaceWebhookDeliveries(workspaceId, 50),
    listWorkspaceIntegrationConnections(workspaceId),
  ])

  return <main className="space-y-6">
    <header>
      <h1 className="text-3xl font-bold">Integrations</h1>
      <p className="mt-1 text-muted-foreground">Mint API keys and register webhook endpoints to push document data into other tools.</p>
      {membership.role !== "owner" && <p className="mt-2 text-sm text-muted-foreground">Only workspace owners can change these.</p>}
    </header>
    <IntegrationsManager
      workspaceId={workspaceId}
      isOwner={membership.role === "owner"}
      eventTypes={[...WEBHOOK_EVENT_TYPES]}
      apiKeys={apiKeys}
      endpoints={endpoints}
      deliveries={deliveries}
      accountingProviders={{ quickbooks: config.integrations.quickbooks.enabled, xero: config.integrations.xero.enabled }}
      connections={connections}
    />
  </main>
}
