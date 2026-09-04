import { AccountingDashboard } from "@/components/accounting/accounting-dashboard"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { getEntityCounts, getLastSyncedAt } from "@/models/accounting-entities"
import { getWorkspaceProvisionJob } from "@/models/bigcapital"
import { listReadyToPushDocuments } from "@/models/documents"
import { getCategoryAccountMap, getWorkspaceIntegrationConnection } from "@/models/integrations"
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
  const [readyToPush, categoryAccountMap] = pushable
    ? await Promise.all([listReadyToPushDocuments(workspaceId, connection.id), getCategoryAccountMap(connection.id)])
    : [[], {}]

  return <main className="space-y-8">
    <header className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Accounting</h1>
        <p className="mt-1 text-sm text-slate-500">Your workspace&apos;s own ledger — coded accounts and vendors, ready for documents to push into.</p>
        {membership.role !== "owner" && <p className="mt-2 text-xs text-slate-400">Only workspace owners can manage this connection.</p>}
      </div>
      {connection?.status === "active" && connection.externalTenantId && (
        <a
          href={config.integrations.bigcapital.apiBase}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
          Open Accounting
        </a>
      )}
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
      categoryAccountMap={categoryAccountMap}
    />
  </main>
}
