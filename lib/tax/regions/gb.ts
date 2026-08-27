import type { TaxRegionConfig } from "@/lib/tax/types"

/** United Kingdom. Standard rate 20% since 2011-01-04, reduced rate 5% (domestic fuel/power,
 * children's car seats, certain mobility aids), zero rate 0% (most food, books, children's
 * clothing, exports) — verified current as of August 2026 against HMRC-referencing guides.
 *
 * mtdReady is false: Making Tax Digital for VAT has been mandatory for every VAT-registered
 * business since April 2022, but this app has no HMRC integration to file through — the flag
 * records what a UK workspace's filing obligation actually is, not whether this app meets it. */
export const GB_TAX_REGION: TaxRegionConfig = {
  region: "gb",
  name: "United Kingdom",
  currency: "GBP",
  taxType: "vat",
  rates: [
    { label: "Standard", rate: 0.20, effectiveFrom: "2011-01-04", effectiveTo: null },
    { label: "Reduced", rate: 0.05, effectiveFrom: "2011-01-04", effectiveTo: null },
    { label: "Zero-rated", rate: 0, effectiveFrom: "2011-01-04", effectiveTo: null },
  ],
  registrationNumberLabel: "VAT registration number",
  registrationNumberPattern: "^GB\\d{9}$",
  mtdReady: false,
  form1099Fields: [],
}
