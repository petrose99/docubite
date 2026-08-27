import type { TaxRegionConfig } from "@/lib/tax/types"

/** South Africa. VAT rose from 14% to 15% on 2018-04-01 (Rates and Monetary Amounts and Amendment
 * of Revenue Laws Act, 2018) and, after the 2025 Budget's proposed further increase was withdrawn
 * following legal challenges, remains 15% as of the 2026 Budget — verified against SARS's own VAT
 * page and independent trackers, both current as of August 2026. */
export const ZA_TAX_REGION: TaxRegionConfig = {
  region: "za",
  name: "South Africa",
  currency: "ZAR",
  taxType: "vat",
  rates: [{ label: "Standard", rate: 0.15, effectiveFrom: "2018-04-01", effectiveTo: null }],
  registrationNumberLabel: "VAT registration number",
  registrationNumberPattern: "^4\\d{9}$",
  mtdReady: false,
  form1099Fields: [],
}
