// Deliberately NOT a "use server" module, matching models/files.ts and models/workspaces.ts: these
// helpers trust the workspaceId they are handed. The server action doing the auth lives in
// app/(app)/workspaces/[workspaceId]/tax-actions.ts.
import { prisma } from "@/lib/db"
import { TAX_REGIONS } from "@/lib/tax/regions"
import type { TaxRegionCode, TaxRegionConfig } from "@/lib/tax/types"
import { Prisma } from "@/prisma/client"

export type TaxProfileWithConfig = { id: string; region: string; currentVersion: number; config: TaxRegionConfig }

export async function getTaxProfile(workspaceId: string): Promise<TaxProfileWithConfig | null> {
  const profile = await prisma.taxProfile.findFirst({
    where: { workspaceId },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  })
  if (!profile?.versions[0]) return null
  return { id: profile.id, region: profile.region, currentVersion: profile.currentVersion, config: profile.versions[0].config as unknown as TaxRegionConfig }
}

/** Sets (or first creates) a workspace's tax region, snapshotting the region's current config as
 * a new immutable TaxProfileVersion — the DocumentTemplate pattern (currentVersion + versions),
 * so a later change to lib/tax/regions.ts's rate table never rewrites what an already-checked
 * document was compared against (WP12). Region overrides beyond picking one of the four launch
 * regions are not offered yet; the snapshot shape already supports one when they are. */
export async function setTaxRegion(workspaceId: string, region: TaxRegionCode) {
  const regionConfig = TAX_REGIONS[region] as unknown as Prisma.InputJsonValue
  const existing = await prisma.taxProfile.findFirst({ where: { workspaceId }, select: { id: true, currentVersion: true } })

  if (!existing) {
    return prisma.taxProfile.create({
      data: { workspaceId, region, versions: { create: { version: 1, config: regionConfig } } },
    })
  }

  const nextVersion = existing.currentVersion + 1
  await prisma.$transaction([
    prisma.taxProfile.update({ where: { id: existing.id }, data: { region, currentVersion: nextVersion } }),
    prisma.taxProfileVersion.create({ data: { profileId: existing.id, version: nextVersion, config: regionConfig } }),
  ])
}
