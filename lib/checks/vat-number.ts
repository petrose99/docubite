import type { CheckResult } from "@/lib/checks/types"

export type VatNumberInput = {
  vatNumber: string | null
  registrationNumberPattern: string
}

/** The supplier's VAT number against the workspace's TaxProfile format (lib/tax/types.ts's
 * registrationNumberPattern) — a plausible typo or wrong-region number worth a second look, not
 * a hard block, hence "warn" only. Returns null when there is nothing to compare, or when the
 * stored pattern itself is not a valid regex (a data error in the tax profile, not this
 * document's fault). */
export function checkVatNumber(input: VatNumberInput): CheckResult | null {
  if (!input.vatNumber) return null

  let pattern: RegExp
  try {
    pattern = new RegExp(input.registrationNumberPattern)
  } catch {
    return null
  }

  const normalized = input.vatNumber.replace(/\s+/g, "")
  if (pattern.test(normalized)) {
    return { checkCode: "vat_number_format", status: "pass", message: "Supplier VAT number matches the expected format.", detail: { vatNumber: input.vatNumber } }
  }
  return {
    checkCode: "vat_number_format", status: "warn",
    message: `Supplier VAT number "${input.vatNumber}" does not match the expected format for this tax region.`,
    detail: { vatNumber: input.vatNumber },
  }
}
