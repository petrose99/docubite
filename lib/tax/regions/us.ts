import type { TaxRegionConfig } from "@/lib/tax/types"

/** United States. No federal VAT or sales tax — sales tax is set state-by-state (and often
 * further by county/city), with wildly different rates and nexus rules. Modeling that table is an
 * explicit Phase 1 deferral (see the roadmap's "Explicit deferrals"), so `rates` is empty rather
 * than asserting a single number that would be wrong for most of the country; WP12's tax-
 * consistency check has nothing to compare a US document against until that table exists.
 *
 * form1099Fields is populated because 1099 reporting (independent-contractor and vendor payments)
 * is federal and its field requirements are stable regardless of state. */
export const US_TAX_REGION: TaxRegionConfig = {
  region: "us",
  name: "United States",
  currency: "USD",
  taxType: "sales_tax",
  rates: [],
  registrationNumberLabel: "EIN (Employer Identification Number)",
  registrationNumberPattern: "^\\d{2}-\\d{7}$",
  mtdReady: false,
  form1099Fields: ["payee_tin", "payee_name", "payee_address", "nonemployee_compensation", "federal_income_tax_withheld"],
}
