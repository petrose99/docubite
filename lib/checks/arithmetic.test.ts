import { describe, expect, it } from "vitest"
import { checkInvoiceArithmetic, type ArithmeticInput } from "@/lib/checks/arithmetic"

const base = (overrides: Partial<ArithmeticInput> = {}): ArithmeticInput => ({
  currencyCode: "USD", subtotal: 100, taxTotal: 20, total: 120, lineItems: [],
  ...overrides,
})

describe("checkInvoiceArithmetic", () => {
  it("passes when subtotal + tax equals total exactly", () => {
    expect(checkInvoiceArithmetic(base())?.status).toBe("pass")
  })

  it("fails when subtotal + tax does not equal total", () => {
    const result = checkInvoiceArithmetic(base({ total: 130 }))
    expect(result?.status).toBe("fail")
    expect(result?.message).toContain("120")
  })

  it("tolerates a rounding-noise discrepancy under half a cent", () => {
    expect(checkInvoiceArithmetic(base({ subtotal: 10.001, taxTotal: 2, total: 12.001 }))?.status).toBe("pass")
  })

  it("fails a discrepancy of exactly one cent", () => {
    expect(checkInvoiceArithmetic(base({ total: 120.01 }))?.status).toBe("fail")
  })

  it("uses a whole-unit tolerance for a zero-decimal currency", () => {
    expect(checkInvoiceArithmetic(base({ currencyCode: "JPY", subtotal: 1000, taxTotal: 200, total: 1200.4 }))?.status).toBe("pass")
    expect(checkInvoiceArithmetic(base({ currencyCode: "JPY", subtotal: 1000, taxTotal: 200, total: 1201 }))?.status).toBe("fail")
  })

  it("returns null when there is nothing to check", () => {
    expect(checkInvoiceArithmetic({ currencyCode: "USD", subtotal: null, taxTotal: null, total: null, lineItems: [] })).toBeNull()
  })

  it("checks line items against subtotal when both are present", () => {
    const result = checkInvoiceArithmetic(base({ lineItems: [{ amount: 60 }, { amount: 40 }] }))
    expect(result?.status).toBe("pass")
  })

  it("fails when line items don't sum to the subtotal", () => {
    const result = checkInvoiceArithmetic(base({ lineItems: [{ amount: 60 }, { amount: 30 }] }))
    expect(result?.status).toBe("fail")
    expect(result?.message).toContain("subtotal")
  })

  it("checks line items against total when there is no subtotal field", () => {
    const result = checkInvoiceArithmetic({ currencyCode: "USD", subtotal: null, taxTotal: null, total: 100, lineItems: [{ amount: 60 }, { amount: 40 }] })
    expect(result?.status).toBe("pass")
  })

  it("skips the line-item comparison when any row is missing an amount, rather than guessing", () => {
    const result = checkInvoiceArithmetic(base({ lineItems: [{ amount: 60 }, { amount: null }] }))
    expect(result?.status).toBe("pass") // header arithmetic alone still checks out
    expect(result?.detail?.lineItemSum).toBeUndefined()
  })

  it("reports both a header mismatch and a line-item mismatch together", () => {
    const result = checkInvoiceArithmetic(base({ total: 999, lineItems: [{ amount: 1 }, { amount: 1 }] }))
    expect(result?.status).toBe("fail")
    expect(result?.message).toContain(";")
  })
})
