import { amountsMatch, type CheckResult } from "@/lib/checks/types"
import type { TaxRate } from "@/lib/tax/types"

export type TaxConsistencyInput = {
  currencyCode: string | null
  /// The document's own date (issue_date/purchase_date) — which rate was in force is decided by
  /// this, not by today's date, so a document from 2018 is checked against 2018's rate.
  documentDate: Date | null
  subtotal: number | null
  taxTotal: number | null
  rates: TaxRate[]
}

/** subtotal × (the workspace's TaxProfile rate in force on the document's date) ≈ tax total — WP4's
 * payoff: the whole reason TaxRegionConfig carries rates with effective dates rather than one
 * number is so this comparison is correct for a document from before the last rate change, not
 * just for one dated today.
 *
 * "Standard" is preferred among rates in force on that date (most documents pay the standard
 * rate); the first rate in force is used if none is labelled that. Returns null — nothing to
 * check — when there is no subtotal/tax/date to compare, or no rate was in force on that date at
 * all (a document dated before this region's tax system existed, or a data error). */
export function checkTaxConsistency(input: TaxConsistencyInput): CheckResult | null {
  if (input.subtotal === null || input.taxTotal === null || !input.documentDate) return null
  const rate = rateInForceOn(input.rates, input.documentDate)
  if (!rate) return null

  const expectedTax = input.subtotal * rate.rate
  const detail = { rateLabel: rate.label, rate: rate.rate, expectedTax, taxTotal: input.taxTotal }

  if (amountsMatch(expectedTax, input.taxTotal, input.currencyCode)) {
    return { checkCode: "tax_consistency", status: "pass", message: `Tax matches the ${rate.label} rate (${percent(rate.rate)}).`, detail }
  }
  return {
    checkCode: "tax_consistency", status: "warn", detail,
    message: `Expected tax at the ${rate.label} rate (${percent(rate.rate)}) is ${round2(expectedTax)}, but tax total is ${input.taxTotal}.`,
  }
}

function rateInForceOn(rates: TaxRate[], date: Date): TaxRate | null {
  const iso = date.toISOString().slice(0, 10)
  const inForce = rates.filter((rate) => rate.effectiveFrom <= iso && (!rate.effectiveTo || rate.effectiveTo >= iso))
  return inForce.find((rate) => rate.label.toLowerCase() === "standard") ?? inForce[0] ?? null
}

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
