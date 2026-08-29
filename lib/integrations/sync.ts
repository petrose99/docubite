import { prisma } from "@/lib/db"
import { getValidAccessToken } from "@/lib/integration-token-refresh"
import * as quickbooks from "@/lib/integrations/quickbooks/client"
import * as xero from "@/lib/integrations/xero/client"
import { Prisma } from "@/prisma/client"

/** WP1.5: pulls the chart of accounts, vendor list, and tax rates from the connection's provider
 * and upserts them as AccountingEntity rows — the local cache the rules UI's account picker
 * (WP1.6) reads from, so it never needs a live provider round-trip on page render. Any row from a
 * prior sync that the provider no longer returns is marked inactive rather than deleted: a rule
 * already pointing at a retired account should keep showing what it points at, not go blank. */
export async function syncAccountingEntities(connectionId: string): Promise<void> {
  const connection = await prisma.integrationConnection.findUniqueOrThrow({
    where: { id: connectionId },
    select: { id: true, workspaceId: true, provider: true, externalTenantId: true },
  })
  if (!connection.externalTenantId) throw new Error("integration_connection_not_ready")

  const accessToken = await getValidAccessToken(connection.id)
  const rows = connection.provider === "quickbooks"
    ? await fetchQuickBooksEntities(connection.externalTenantId, accessToken)
    : await fetchXeroEntities(connection.externalTenantId, accessToken)

  const syncedAt = new Date()
  await prisma.$transaction([
    ...rows.map((row) => prisma.accountingEntity.upsert({
      where: { connectionId_entityType_externalId: { connectionId: connection.id, entityType: row.entityType, externalId: row.externalId } },
      create: { workspaceId: connection.workspaceId, connectionId: connection.id, entityType: row.entityType, externalId: row.externalId, code: row.code, name: row.name, active: row.active, raw: row.raw as Prisma.InputJsonValue, syncedAt },
      update: { code: row.code, name: row.name, active: row.active, raw: row.raw as Prisma.InputJsonValue, syncedAt },
    })),
    prisma.accountingEntity.updateMany({
      where: { connectionId: connection.id, syncedAt: { lt: syncedAt } },
      data: { active: false },
    }),
  ])
}

type SyncRow = { entityType: "account" | "vendor" | "tax_rate"; externalId: string; code: string | null; name: string; active: boolean; raw: unknown }

async function fetchQuickBooksEntities(realmId: string, accessToken: string): Promise<SyncRow[]> {
  const [accounts, vendors, taxCodes] = await Promise.all([
    quickbooks.listAccounts(realmId, accessToken),
    quickbooks.listVendors(realmId, accessToken),
    quickbooks.listTaxCodes(realmId, accessToken),
  ])
  return [
    ...accounts.map((a): SyncRow => ({ entityType: "account", externalId: a.id, code: null, name: a.name, active: a.active, raw: a })),
    ...vendors.map((v): SyncRow => ({ entityType: "vendor", externalId: v.id, code: null, name: v.name, active: v.active, raw: v })),
    ...taxCodes.map((t): SyncRow => ({ entityType: "tax_rate", externalId: t.id, code: null, name: t.name, active: t.active, raw: t })),
  ]
}

async function fetchXeroEntities(tenantId: string, accessToken: string): Promise<SyncRow[]> {
  const [accounts, contacts, taxRates] = await Promise.all([
    xero.listAccounts(tenantId, accessToken),
    xero.listContacts(tenantId, accessToken),
    xero.listTaxRates(tenantId, accessToken),
  ])
  return [
    ...accounts.map((a): SyncRow => ({ entityType: "account", externalId: a.code, code: a.code, name: a.name, active: a.active, raw: a })),
    ...contacts.map((c): SyncRow => ({ entityType: "vendor", externalId: c.id, code: null, name: c.name, active: c.active, raw: c })),
    // Xero tax rates have no stable id in the API response — their Name is the only identifier a
    // client ever sees or sets a bill's TaxType from, so it doubles as this row's externalId.
    ...taxRates.map((t): SyncRow => ({ entityType: "tax_rate", externalId: t.name, code: null, name: t.name, active: t.active, raw: t })),
  ]
}
