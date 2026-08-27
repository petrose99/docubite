import { z } from "zod"

/** ZA/Lesotho + UK + US, per the roadmap's launch regions. Not an open set: a new region is a
 * code change (a new lib/tax/regions/*.ts file plus a registry entry), not workspace-entered
 * free text — the whole point is that rates and labels are maintained in one place, not typed by
 * every customer. */
export const TAX_REGION_CODES = ["za", "ls", "gb", "us"] as const
export type TaxRegionCode = (typeof TAX_REGION_CODES)[number]

/** One rate in force over a date range. `effectiveTo: null` means still in force. Kept as a list,
 * not a single number, because WP12's tax-consistency check needs to pick the rate that was
 * actually in force on a document's date — a rate change must not silently misjudge every invoice
 * dated before it. */
export const taxRateSchema = z.object({
  label: z.string(),
  rate: z.number().min(0).max(1),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable().default(null),
})
export type TaxRate = z.infer<typeof taxRateSchema>

export const taxRegionConfigSchema = z.object({
  region: z.enum(TAX_REGION_CODES),
  name: z.string(),
  currency: z.string().length(3),
  taxType: z.enum(["vat", "sales_tax"]),
  /// Empty for a region with no single rate to state — US sales tax is state/local and its
  /// rate/nexus tables are an explicit Phase 1 deferral (see the roadmap); every VAT region
  /// below has at least one.
  rates: z.array(taxRateSchema),
  registrationNumberLabel: z.string(),
  /// A regex source string (not a RegExp instance — this is stored as JSON), validating the
  /// registration number format shown next to registrationNumberLabel.
  registrationNumberPattern: z.string(),
  /// Whether this region's tax authority requires digital filing this app does not yet integrate
  /// with (UK's Making Tax Digital for VAT). Informational only in Phase 1 — no HMRC integration
  /// exists — but the flag is what a later filing feature would gate on.
  mtdReady: z.boolean().default(false),
  /// Extra fields a document template should carry for this region's information-return regime
  /// (US Form 1099-NEC/MISC: payee TIN, box amounts). Empty for regions with no such regime.
  form1099Fields: z.array(z.string()).default([]),
})
export type TaxRegionConfig = z.infer<typeof taxRegionConfigSchema>
