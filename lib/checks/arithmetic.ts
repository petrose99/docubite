import { amountsMatch, type CheckResult } from "@/lib/checks/types"

export type ArithmeticInput = {
  currencyCode: string | null
  subtotal: number | null
  taxTotal: number | null
  total: number | null
  lineItems: { amount: number | null }[]
}

/** subtotal + tax ≈ total, and (when every line item has an amount) the line items sum to
 * whichever of subtotal/total is present. One of only two checks that defaults to "fail" rather
 * than "warn" (the roadmap's own call) — a total that doesn't add up is not a judgment call, it's
 * either a misread number or a genuinely wrong document, and either way it should not reach a
 * ledger unexamined.
 *
 * Returns null — "not applicable" rather than pass/warn/fail — when there isn't enough data to
 * check anything (no subtotal/total, no line items with amounts). A document missing every
 * relevant field is a different problem (missing required fields) than one whose numbers
 * disagree, and this check should not manufacture an opinion about the former. */
export function checkInvoiceArithmetic(input: ArithmeticInput): CheckResult | null {
  const issues: string[] = []
  const detail: Record<string, unknown> = {}

  if (input.subtotal !== null && input.taxTotal !== null && input.total !== null) {
    const expected = input.subtotal + input.taxTotal
    detail.subtotalPlusTax = expected
    if (!amountsMatch(expected, input.total, input.currencyCode)) {
      issues.push(`subtotal (${input.subtotal}) + tax (${input.taxTotal}) = ${round2(expected)}, but total is ${input.total}`)
    }
  }

  const amounts = input.lineItems.map((item) => item.amount)
  const everyAmountPresent = input.lineItems.length > 0 && amounts.every((amount): amount is number => amount !== null)
  if (everyAmountPresent) {
    const sum = amounts.reduce((total, amount) => total + (amount as number), 0)
    const target = input.subtotal ?? input.total
    detail.lineItemSum = sum
    if (target !== null && !amountsMatch(sum, target, input.currencyCode)) {
      issues.push(`line items sum to ${round2(sum)}, but ${input.subtotal !== null ? "subtotal" : "total"} is ${target}`)
    }
  }

  const checkedSomething = (input.subtotal !== null && input.taxTotal !== null && input.total !== null) || (everyAmountPresent && (input.subtotal !== null || input.total !== null))
  if (!checkedSomething) return null

  return issues.length
    ? { checkCode: "invoice_arithmetic", status: "fail", message: issues.join("; "), detail }
    : { checkCode: "invoice_arithmetic", status: "pass", message: "Arithmetic checks out.", detail }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
