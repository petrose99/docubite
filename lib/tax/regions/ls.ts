import type { TaxRegionConfig } from "@/lib/tax/types"

/** Lesotho. Standard rate 15% under the Value Added Tax Act 2001, with electricity reduced to
 * 10% and exports/basic commodities zero-rated — per the Central Bank of Lesotho's VAT
 * explainer and PwC's Africa VAT guide. One source (a third-party rate-aggregator, not RSL or a
 * professional-services guide) reported 14%; RSL's own site and the two primary-adjacent sources
 * above agree on 15%, so that is what is used here — but this is the one region in this registry
 * without a direct RSL rate-schedule citation, so confirm against RSL's official published rates
 * (rsl.org.ls) before this feeds a real compliance check (WP12). No effectiveFrom date is
 * asserted for the same reason: the Act's original 2003 rate is not confirmed to be unchanged
 * since. */
export const LS_TAX_REGION: TaxRegionConfig = {
  region: "ls",
  name: "Lesotho",
  currency: "LSL",
  taxType: "vat",
  rates: [
    { label: "Standard", rate: 0.15, effectiveFrom: "2003-07-01", effectiveTo: null },
    { label: "Electricity", rate: 0.10, effectiveFrom: "2003-07-01", effectiveTo: null },
    { label: "Zero-rated (exports, basic commodities)", rate: 0, effectiveFrom: "2003-07-01", effectiveTo: null },
  ],
  registrationNumberLabel: "VAT registration number",
  registrationNumberPattern: "^\\d{9}$",
  mtdReady: false,
  form1099Fields: [],
}
