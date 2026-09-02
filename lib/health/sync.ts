import { prisma } from "@/lib/db"
import { getValidAccessToken } from "@/lib/integration-token-refresh"
import * as quickbooks from "@/lib/integrations/quickbooks/client"
import * as xero from "@/lib/integrations/xero/client"
import * as bigcapital from "@/lib/integrations/bigcapital/client"
import { unscoped } from "@/lib/workspace-scope"
import { Prisma } from "@/prisma/client"

/** Phase B: pulls bills/expenses/bank-transactions from the connection's provider and upserts
 * them as LedgerTransaction rows — mirrors lib/integrations/sync.ts's syncAccountingEntities
 * exactly (same connection lookup, same getValidAccessToken credential handling, same
 * upsert-then-soft-retire $transaction shape). A row from a prior sync the provider no longer
 * returns is marked inactive rather than deleted, same convention as AccountingEntity. */
export async function syncLedgerTransactions(connectionId: string): Promise<void> {
  const connection = await prisma.integrationConnection.findUniqueOrThrow({
    where: { id: connectionId },
    select: { id: true, workspaceId: true, provider: true, externalTenantId: true },
  })
  if (!connection.externalTenantId) throw new Error("integration_connection_not_ready")

  const accessToken = await getValidAccessToken(connection.id)
  const rows = await fetchProviderLedgerTransactions(connection.provider, connection.externalTenantId, accessToken)

  const syncedAt = new Date()
  await prisma.$transaction([
    ...rows.map((row) => prisma.ledgerTransaction.upsert({
      where: { connectionId_kind_externalId: { connectionId: connection.id, kind: row.kind, externalId: row.externalId } },
      create: {
        workspaceId: connection.workspaceId, connectionId: connection.id, externalId: row.externalId, kind: row.kind,
        contactExternalId: row.contactExternalId, contactName: row.contactName,
        accountExternalId: row.accountExternalId, accountName: row.accountName,
        docNumber: row.docNumber, amount: row.amount, taxAmount: row.taxAmount, currencyCode: row.currencyCode,
        txnDate: row.txnDate, reconciled: row.reconciled, active: true, raw: row.raw as Prisma.InputJsonValue, syncedAt,
      },
      update: {
        contactExternalId: row.contactExternalId, contactName: row.contactName,
        accountExternalId: row.accountExternalId, accountName: row.accountName,
        docNumber: row.docNumber, amount: row.amount, taxAmount: row.taxAmount, currencyCode: row.currencyCode,
        txnDate: row.txnDate, reconciled: row.reconciled, active: true, raw: row.raw as Prisma.InputJsonValue, syncedAt,
      },
    })),
    prisma.ledgerTransaction.updateMany({
      where: { connectionId: connection.id, syncedAt: { lt: syncedAt } },
      data: { active: false },
    }),
  ])
}

const LEDGER_SYNC_STALE_MS = 24 * 60 * 60 * 1000

/** Drains every active IntegrationConnection whose ledger sync is due — more than 24h since its
 * newest LedgerTransaction.syncedAt, or a connection with no LedgerTransaction rows at all yet
 * (synced unconditionally, once). Called from app/api/internal/jobs/process/route.ts's cron drain,
 * same "never throw past the caller" posture as drainIntegrationPushes/drainProvisionJobs: one
 * connection's sync failure (a lapsed token, a provider outage) is logged and skipped, never lets
 * a bad connection block every other workspace's drain. Returns how many connections were synced,
 * for the route's response body. */
export async function syncDueLedgerConnections(): Promise<number> {
  // Draining across every workspace's connections at once is the same shape as
  // IntegrationPush/WebhookDelivery's global drains — deliberately unscoped, per
  // lib/workspace-scope.ts's own documented exception for background workers that claim jobs
  // across all tenants.
  const connections = await unscoped(() => prisma.integrationConnection.findMany({
    where: { status: "active" },
    select: { id: true },
  }))
  if (!connections.length) return 0

  const latestSyncByConnection = new Map(
    (await unscoped(() => prisma.ledgerTransaction.groupBy({
      by: ["connectionId"],
      _max: { syncedAt: true },
      where: { connectionId: { in: connections.map((c) => c.id) } },
    }))).map((row) => [row.connectionId, row._max.syncedAt]),
  )

  const now = Date.now()
  let synced = 0
  for (const connection of connections) {
    const latestSyncedAt = latestSyncByConnection.get(connection.id)
    const due = !latestSyncedAt || now - latestSyncedAt.getTime() > LEDGER_SYNC_STALE_MS
    if (!due) continue
    try {
      await syncLedgerTransactions(connection.id)
      synced++
    } catch (error) {
      console.error(`[health] failed to sync ledger for connection ${connection.id}:`, error instanceof Error ? error.message : error)
    }
  }
  return synced
}

type SyncRow = {
  kind: "bill" | "expense" | "bank_transaction"
  externalId: string
  contactExternalId: string | null
  contactName: string | null
  accountExternalId: string | null
  accountName: string | null
  docNumber: string | null
  amount: number | null
  taxAmount: number | null
  currencyCode: string | null
  txnDate: Date | null
  reconciled: boolean
  raw: unknown
}

function toDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function fetchProviderLedgerTransactions(provider: string, externalTenantId: string, accessToken: string): Promise<SyncRow[]> {
  switch (provider) {
    case "quickbooks":
      return fetchQuickBooksLedgerTransactions(externalTenantId, accessToken)
    case "xero":
      return fetchXeroLedgerTransactions(externalTenantId, accessToken)
    case "bigcapital":
      return fetchBigcapitalLedgerTransactions(externalTenantId, accessToken)
    default:
      throw new Error(`unsupported_integration_provider_${provider}`)
  }
}

/** QuickBooks has no separate bank-transaction entity — its Purchase entity already covers
 * non-bill spend, so it doubles as this app's "expense" kind and no "bank_transaction" rows are
 * ever produced for this provider (see lib/integrations/quickbooks/client.ts's listExpenses). Every
 * row starts reconciled: false — QuickBooks' API has no "cleared/reconciled" flag on Bill/Purchase
 * (that concept lives on bank feed transactions, which this app doesn't sync), so
 * unreconciled_transactions.ts is only ever informative, never a false "already reconciled". */
async function fetchQuickBooksLedgerTransactions(realmId: string, accessToken: string): Promise<SyncRow[]> {
  const [bills, expenses] = await Promise.all([
    quickbooks.listBills(realmId, accessToken),
    quickbooks.listExpenses(realmId, accessToken),
  ])
  return [
    ...bills.map((b): SyncRow => ({
      kind: "bill", externalId: b.id, contactExternalId: b.contactId, contactName: b.contactName,
      accountExternalId: b.accountId, accountName: b.accountName, docNumber: b.docNumber,
      amount: b.totalAmt, taxAmount: null, currencyCode: b.currencyCode, txnDate: toDate(b.txnDate),
      reconciled: false, raw: b,
    })),
    ...expenses.map((e): SyncRow => ({
      kind: "expense", externalId: e.id, contactExternalId: e.contactId, contactName: e.contactName,
      accountExternalId: e.accountId, accountName: e.accountName, docNumber: e.docNumber,
      amount: e.totalAmt, taxAmount: null, currencyCode: e.currencyCode, txnDate: toDate(e.txnDate),
      reconciled: false, raw: e,
    })),
  ]
}

/** Xero has no separate "expense" entity — a SPEND bank transaction already covers non-bill spend,
 * so no "expense" rows are ever produced for this provider (see
 * lib/integrations/xero/client.ts's listBankTransactions). accountCode doubles as both
 * accountExternalId and accountName here (Xero accounts have no separate numeric id — see
 * lib/integrations/sync.ts's fetchXeroEntities using the same Code-as-id convention). */
async function fetchXeroLedgerTransactions(tenantId: string, accessToken: string): Promise<SyncRow[]> {
  const [bills, bankTransactions] = await Promise.all([
    xero.listBills(tenantId, accessToken),
    xero.listBankTransactions(tenantId, accessToken),
  ])
  return [
    ...bills.map((b): SyncRow => ({
      kind: "bill", externalId: b.id, contactExternalId: b.contactId, contactName: b.contactName,
      accountExternalId: b.accountCode, accountName: b.accountCode, docNumber: b.docNumber,
      amount: b.total, taxAmount: null, currencyCode: b.currencyCode, txnDate: toDate(b.txnDate),
      reconciled: false, raw: b,
    })),
    ...bankTransactions.map((t): SyncRow => ({
      kind: "bank_transaction", externalId: t.id, contactExternalId: t.contactId, contactName: t.contactName,
      accountExternalId: t.accountCode, accountName: t.accountCode, docNumber: t.docNumber,
      amount: t.total, taxAmount: null, currencyCode: t.currencyCode, txnDate: toDate(t.txnDate),
      reconciled: false, raw: t,
    })),
  ]
}

/** Bigcapital's connection carries an API key (never rotated by getValidAccessToken — see
 * models/bigcapital.ts) rather than an OAuth access token, same as fetchBigcapitalEntities in
 * lib/integrations/sync.ts. No bank-transaction list is synced for this provider — its
 * /api/banking/transactions endpoint requires a specific accountId (verified against a real
 * instance during this phase; there is no top-level "list every bank transaction" endpoint), which
 * doesn't fit this sync's one-connection-wide pull; a later phase can add a per-account loop once
 * bank/cash accounts are identifiable from cached data (see control-account-postings.ts's note
 * about account-type data not being cached today). */
async function fetchBigcapitalLedgerTransactions(organizationId: string, apiKey: string): Promise<SyncRow[]> {
  const [bills, expenses] = await Promise.all([
    bigcapital.listBills(apiKey, organizationId),
    bigcapital.listExpenses(apiKey, organizationId),
  ])
  return [
    ...bills.map((b): SyncRow => ({
      kind: "bill", externalId: b.id, contactExternalId: b.contactId, contactName: b.contactName,
      accountExternalId: b.accountId, accountName: b.accountName, docNumber: b.docNumber,
      amount: b.total, taxAmount: b.taxAmount, currencyCode: b.currencyCode, txnDate: toDate(b.txnDate),
      reconciled: false, raw: b,
    })),
    ...expenses.map((e): SyncRow => ({
      kind: "expense", externalId: e.id, contactExternalId: e.contactId, contactName: e.contactName,
      accountExternalId: e.accountId, accountName: e.accountName, docNumber: e.docNumber,
      amount: e.total, taxAmount: e.taxAmount, currencyCode: e.currencyCode, txnDate: toDate(e.txnDate),
      reconciled: false, raw: e,
    })),
  ]
}
