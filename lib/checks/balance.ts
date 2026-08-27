import { amountsMatch, type CheckResult } from "@/lib/checks/types"

export type BalanceInput = {
  currencyCode: string | null
  openingBalance: number | null
  closingBalance: number | null
  transactions: { debit: number | null; credit: number | null }[]
}

/** opening balance + Σ(credit − debit) ≈ closing balance. Warn, not fail (the roadmap's default
 * severity) — a statement's own printed running balance can legitimately be off by a rounding
 * unit the source document itself got wrong, so this is worth a look, not an automatic block. */
export function checkStatementBalance(input: BalanceInput): CheckResult | null {
  if (input.openingBalance === null || input.closingBalance === null) return null

  const netMovement = input.transactions.reduce((sum, transaction) => sum + (transaction.credit ?? 0) - (transaction.debit ?? 0), 0)
  const expectedClosing = input.openingBalance + netMovement
  const detail = { openingBalance: input.openingBalance, netMovement, expectedClosing, closingBalance: input.closingBalance }

  if (amountsMatch(expectedClosing, input.closingBalance, input.currencyCode)) {
    return { checkCode: "statement_balance", status: "pass", message: "Opening balance plus transactions matches the closing balance.", detail }
  }
  return {
    checkCode: "statement_balance", status: "warn", detail,
    message: `Opening (${input.openingBalance}) + net movement (${round2(netMovement)}) = ${round2(expectedClosing)}, but closing balance is ${input.closingBalance}`,
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
