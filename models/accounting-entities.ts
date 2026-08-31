// Deliberately NOT a "use server" module, matching every other models/*.ts helper: trusts the
// workspaceId it is handed. Writes happen only in lib/integrations/sync.ts's syncAccountingEntities.
import { prisma } from "@/lib/db"
import { cache } from "react"

export const listAccountingEntities = cache(async (workspaceId: string, entityType: "account" | "vendor" | "tax_rate") => prisma.accountingEntity.findMany({
  where: { workspaceId, entityType, active: true },
  orderBy: { name: "asc" },
}))

/** The most recent sync across every entity type for this workspace's connection, or null if it
 * has never been synced — the settings card's "last synced" timestamp. */
export const getLastSyncedAt = cache(async (connectionId: string): Promise<Date | null> => {
  const row = await prisma.accountingEntity.findFirst({ where: { connectionId }, orderBy: { syncedAt: "desc" }, select: { syncedAt: true } })
  return row?.syncedAt ?? null
})

/** Active account/vendor counts for the Accounting tab's "Sync & coding" card — how much a "Sync
 * now" actually pulled in, without the caller loading every row. */
export const getEntityCounts = cache(async (connectionId: string): Promise<{ accounts: number; vendors: number }> => {
  const [accounts, vendors] = await Promise.all([
    prisma.accountingEntity.count({ where: { connectionId, entityType: "account", active: true } }),
    prisma.accountingEntity.count({ where: { connectionId, entityType: "vendor", active: true } }),
  ])
  return { accounts, vendors }
})
