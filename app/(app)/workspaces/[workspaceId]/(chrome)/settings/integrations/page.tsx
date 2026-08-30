import { IntegrationsManager } from "@/components/integrations/integrations-manager"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { WEBHOOK_EVENT_TYPES } from "@/lib/webhooks"
import {
  listWorkspaceApiKeys,
  listWorkspaceIntegrationConnections,
  listWorkspaceWebhookDeliveries,
  listWorkspaceWebhookEndpoints,
} from "@/models/integrations"
import { getLastSyncedAt } from "@/models/accounting-entities"
import { requireWorkspaceRole } from "@/models/workspaces"
import { notFound } from "next/navigation"

/** Outbound integrations: API keys + webhook endpoints + delivery history. Hard-gated on the
 * deployment having an encryption key (config.integrations.enabled) — with it off the sidebar entry
 * is omitted and this page 404s, so there is never a front door onto a feature the server can't run.
 * Every workspace has this now — there is no plan tier gating it anymore. */
export default async function IntegrationsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  if (!config.integrations.enabled) notFound()
  const { workspaceId } = await params
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)

  const [apiKeys, endpoints, deliveries, connections] = await Promise.all([
    listWorkspaceApiKeys(workspaceId),
    listWorkspaceWebhookEndpoints(workspaceId),
    listWorkspaceWebhookDeliveries(workspaceId, 50),
    listWorkspaceIntegrationConnections(workspaceId),
  ])
  const connectionsWithSync = await Promise.all(connections.map(async (connection) => ({ ...connection, lastSyncedAt: await getLastSyncedAt(connection.id) })))

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
      connections={connectionsWithSync}
    />
  </main>
}
