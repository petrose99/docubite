/** Phase B: flags two AccountingEntity vendor/contact rows on the same connection whose names
 * normalize to the same string — "Acme Ltd" vs "Acme Ltd." vs "ACME LTD", say — a common source
 * of split spend history and duplicate payments at the provider. Name-only, since that is the one
 * field every provider's vendor/contact sync actually caches today (see
 * lib/integrations/sync.ts's SyncRow — no address/tax-id is stored). */
import type { CheckDefinition, CheckRunResult, LedgerAccountingEntitySlice } from "@/lib/health/types"

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

export const duplicateContactsCheck: CheckDefinition = {
  code: "duplicate_contacts",
  name: "Duplicate vendor contacts",
  category: "cleanup",
  defaultWeight: 1,
  requiresLedger: true,
  run: (ctx): CheckRunResult => {
    const vendors = (ctx.ledger?.accountingEntities ?? []).filter((e) => e.entityType === "vendor" && e.active)
    const applicableCount = vendors.length
    if (!applicableCount) return { findings: [], applicableCount }

    const byNormalizedName = new Map<string, LedgerAccountingEntitySlice[]>()
    for (const vendor of vendors) {
      const key = normalize(vendor.name)
      if (!key) continue
      const group = byNormalizedName.get(key) ?? []
      group.push(vendor)
      byNormalizedName.set(key, group)
    }

    const findings: CheckRunResult["findings"] = []
    for (const group of byNormalizedName.values()) {
      if (group.length < 2) continue
      findings.push({
        checkCode: "duplicate_contacts",
        category: "cleanup",
        severity: "warning",
        title: `${group.length} vendor contacts look like the same vendor: "${group[0].name}"`,
        description: `${group.map((v) => v.name).join(", ")} normalize to the same name — likely duplicate vendor records at your accounting provider.`,
        // Doubles as the fingerprint's disambiguator, same reason dormant-accounts.ts sets it —
        // without a distinct value per group, two different duplicate-name groups in the same
        // workspace would collide onto one HealthCheckResult row.
        externalTransactionId: group[0].externalId,
        suggestedAction: null,
        suggestedActionPayload: { externalIds: group.map((v) => v.externalId) },
        affectedCount: group.length,
      })
    }

    return { findings, applicableCount }
  },
}
