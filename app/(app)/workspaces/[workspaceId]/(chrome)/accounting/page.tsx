import { AccountingDashboard } from "@/components/accounting/accounting-dashboard"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { getEntityCounts, getLastSyncedAt } from "@/models/accounting-entities"
import { getWorkspaceProvisionJob } from "@/models/bigcapital"
import { listReadyToPushDocuments } from "@/models/documents"
import { getWorkspaceIntegrationConnection } from "@/models/integrations"
import { requireWorkspaceRole } from "@/models/workspaces"
import { notFound } from "next/navigation"

/** The accounting bridge surface: connection status, chart-of-accounts/vendor sync, and the default
 * expense account picker. Hard-gated on the deployment having accounting configured. */
export default async function AccountingPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  if (!config.integrations.bigcapital.enabled) notFound()
  const { workspaceId } = await params
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)

  const [connection, job] = await Promise.all([
    getWorkspaceIntegrationConnection(workspaceId, "bigcapital"),
    getWorkspaceProvisionJob(workspaceId),
  ])
  const [lastSyncedAt, entityCounts] = connection
    ? await Promise.all([getLastSyncedAt(connection.id), getEntityCounts(connection.id)])
    : [null, { accounts: 0, vendors: 0 }]

  // Same "pushable" gate PushToAccountingCard uses on a single document: an active connection with
  // a default expense account chosen. No point loading the ready list otherwise — nothing could push.
  const pushable = connection?.status === "active" && !!connection.defaultExpenseAccountId
  const readyToPush = pushable ? await listReadyToPushDocuments(workspaceId, connection.id) : []

  return <main className="space-y-6">
    <header>
      <h1 className="text-3xl font-bold">Accounting</h1>
      <p className="mt-1 text-muted-foreground">Your workspace&apos;s own ledger — coded accounts and vendors, ready for documents to push into.</p>
      {membership.role !== "owner" && <p className="mt-2 text-sm text-muted-foreground">Only workspace owners can manage this connection.</p>}
    </header>
    <AccountingDashboard
      workspaceId={workspaceId}
      isOwner={membership.role === "owner"}
      apiBase={config.integrations.bigcapital.apiBase}
      connection={connection}
      job={job}
      lastSyncedAt={lastSyncedAt}
      entityCounts={entityCounts}
      readyToPush={readyToPush}
    />
  </main>
}
