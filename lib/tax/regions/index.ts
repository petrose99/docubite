import { GB_TAX_REGION } from "@/lib/tax/regions/gb"
import { LS_TAX_REGION } from "@/lib/tax/regions/ls"
import { US_TAX_REGION } from "@/lib/tax/regions/us"
import { ZA_TAX_REGION } from "@/lib/tax/regions/za"
import { taxRegionConfigSchema, type TaxRegionCode, type TaxRegionConfig } from "@/lib/tax/types"

export const TAX_REGIONS: Record<TaxRegionCode, TaxRegionConfig> = {
  za: ZA_TAX_REGION,
  ls: LS_TAX_REGION,
  gb: GB_TAX_REGION,
  us: US_TAX_REGION,
}

// Fails at import time — a code region and its config falling out of sync is a deploy-blocking
// mistake, not something that should surface only when a workspace happens to pick that region.
for (const [code, region] of Object.entries(TAX_REGIONS)) taxRegionConfigSchema.parse({ ...region, region: code })

export function getTaxRegion(code: TaxRegionCode): TaxRegionConfig {
  return TAX_REGIONS[code]
}

export const TAX_REGION_LIST = Object.values(TAX_REGIONS)
