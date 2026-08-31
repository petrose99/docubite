import { prisma } from "@/lib/db"
import type { Prisma } from "@/prisma/client"
import { randomUUID } from "crypto"

/** Per-user, per-workspace, per-view (`viewKey`) column/filter/sort preferences for a list —
 * today just the pipeline list, one row per tab a user has customized. Server-side rather than
 * localStorage: a preference set on one device must survive a switch to another. */
export type ListPreference = { columns: string[]; filters: Record<string, unknown>; sort: { field: string; dir: "asc" | "desc" } }

export async function getListPreference(userId: string, workspaceId: string, viewKey: string): Promise<ListPreference | null> {
  const row = await prisma.userListPreference.findUnique({ where: { userId_workspaceId_viewKey: { userId, workspaceId, viewKey } } })
  if (!row) return null
  return { columns: row.columns as string[], filters: row.filters as Record<string, unknown>, sort: row.sort as ListPreference["sort"] }
}

export async function saveListPreference(userId: string, workspaceId: string, viewKey: string, preference: ListPreference) {
  await prisma.userListPreference.upsert({
    where: { userId_workspaceId_viewKey: { userId, workspaceId, viewKey } },
    create: { id: randomUUID(), userId, workspaceId, viewKey, columns: preference.columns as Prisma.InputJsonValue, filters: preference.filters as Prisma.InputJsonValue, sort: preference.sort as Prisma.InputJsonValue },
    update: { columns: preference.columns as Prisma.InputJsonValue, filters: preference.filters as Prisma.InputJsonValue, sort: preference.sort as Prisma.InputJsonValue },
  })
}
