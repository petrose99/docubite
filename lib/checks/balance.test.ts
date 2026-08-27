import { describe, expect, it } from "vitest"
import { checkStatementBalance } from "@/lib/checks/balance"

describe("checkStatementBalance", () => {
  it("returns null without an opening or closing balance", () => {
    expect(checkStatementBalance({ currencyCode: "USD", openingBalance: null, closingBalance: 100, transactions: [] })).toBeNull()
    expect(checkStatementBalance({ currencyCode: "USD", openingBalance: 100, closingBalance: null, transactions: [] })).toBeNull()
  })

  it("passes when opening plus net movement equals closing", () => {
    const result = checkStatementBalance({
      currencyCode: "USD", openingBalance: 1000, closingBalance: 1150,
      transactions: [{ debit: 50, credit: 200 }, { debit: null, credit: null }],
    })
    expect(result?.status).toBe("pass")
  })

  it("warns, not fails, on a mismatch", () => {
    const result = checkStatementBalance({ currencyCode: "USD", openingBalance: 1000, closingBalance: 1500, transactions: [{ debit: 0, credit: 100 }] })
    expect(result?.status).toBe("warn")
  })

  it("treats a transaction with neither debit nor credit as zero movement", () => {
    const result = checkStatementBalance({ currencyCode: "USD", openingBalance: 500, closingBalance: 500, transactions: [{ debit: null, credit: null }] })
    expect(result?.status).toBe("pass")
  })

  it("tolerates rounding noise but not a real cent-level discrepancy", () => {
    expect(checkStatementBalance({ currencyCode: "USD", openingBalance: 100, closingBalance: 100.001, transactions: [] })?.status).toBe("pass")
    expect(checkStatementBalance({ currencyCode: "USD", openingBalance: 100, closingBalance: 100.02, transactions: [] })?.status).toBe("warn")
  })

  it("sums debits and credits across many transactions", () => {
    const transactions = Array.from({ length: 10 }, () => ({ debit: 10, credit: 5 }))
    // net movement: (5-10) * 10 = -50
    const result = checkStatementBalance({ currencyCode: "USD", openingBalance: 200, closingBalance: 150, transactions })
    expect(result?.status).toBe("pass")
  })
})
