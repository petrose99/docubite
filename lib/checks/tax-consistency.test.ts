import { describe, expect, it } from "vitest"
import { checkTaxConsistency } from "@/lib/checks/tax-consistency"

const ZA_RATES = [{ label: "Standard", rate: 0.15, effectiveFrom: "2018-04-01", effectiveTo: null }]
const GB_RATES = [
  { label: "Standard", rate: 0.20, effectiveFrom: "2011-01-04", effectiveTo: null },
  { label: "Reduced", rate: 0.05, effectiveFrom: "2011-01-04", effectiveTo: null },
  { label: "Zero-rated", rate: 0, effectiveFrom: "2011-01-04", effectiveTo: null },
]

describe("checkTaxConsistency", () => {
  it("returns null without a subtotal, tax total, or document date", () => {
    expect(checkTaxConsistency({ currencyCode: "ZAR", documentDate: new Date("2026-01-01"), subtotal: null, taxTotal: 15, rates: ZA_RATES })).toBeNull()
    expect(checkTaxConsistency({ currencyCode: "ZAR", documentDate: new Date("2026-01-01"), subtotal: 100, taxTotal: null, rates: ZA_RATES })).toBeNull()
    expect(checkTaxConsistency({ currencyCode: "ZAR", documentDate: null, subtotal: 100, taxTotal: 15, rates: ZA_RATES })).toBeNull()
  })

  it("passes when tax matches the standard rate in force on the document's date", () => {
    const result = checkTaxConsistency({ currencyCode: "ZAR", documentDate: new Date("2026-06-01"), subtotal: 100, taxTotal: 15, rates: ZA_RATES })
    expect(result?.status).toBe("pass")
  })

  it("warns when tax does not match the expected rate", () => {
    const result = checkTaxConsistency({ currencyCode: "ZAR", documentDate: new Date("2026-06-01"), subtotal: 100, taxTotal: 14, rates: ZA_RATES })
    expect(result?.status).toBe("warn")
    expect(result?.message).toContain("Standard")
  })

  it("uses the rate that was in force on the document's date, not today's rate", () => {
    const rates = [
      { label: "Standard", rate: 0.14, effectiveFrom: "2000-01-01", effectiveTo: "2018-03-31" },
      { label: "Standard", rate: 0.15, effectiveFrom: "2018-04-01", effectiveTo: null },
    ]
    // Dated before the rate change: 14% is correct, 15% would be flagged.
    const before = checkTaxConsistency({ currencyCode: "ZAR", documentDate: new Date("2017-06-01"), subtotal: 100, taxTotal: 14, rates })
    expect(before?.status).toBe("pass")
    const afterButOldRate = checkTaxConsistency({ currencyCode: "ZAR", documentDate: new Date("2017-06-01"), subtotal: 100, taxTotal: 15, rates })
    expect(afterButOldRate?.status).toBe("warn")
  })

  it("returns null when no rate was in force on the document's date", () => {
    const rates = [{ label: "Standard", rate: 0.15, effectiveFrom: "2018-04-01", effectiveTo: null }]
    expect(checkTaxConsistency({ currencyCode: "ZAR", documentDate: new Date("2010-01-01"), subtotal: 100, taxTotal: 15, rates })).toBeNull()
  })

  it("prefers the Standard-labelled rate among several in force at once", () => {
    const result = checkTaxConsistency({ currencyCode: "GBP", documentDate: new Date("2026-01-01"), subtotal: 100, taxTotal: 20, rates: GB_RATES })
    expect(result?.detail?.rateLabel).toBe("Standard")
  })

  it("handles a zero rate correctly", () => {
    const result = checkTaxConsistency({ currencyCode: "GBP", documentDate: new Date("2026-01-01"), subtotal: 100, taxTotal: 5, rates: [GB_RATES[2]] })
    expect(result?.status).toBe("warn")
    expect(result?.detail?.expectedTax).toBe(0)
  })

  it("returns null for a region with no rates at all (e.g. US)", () => {
    expect(checkTaxConsistency({ currencyCode: "USD", documentDate: new Date("2026-01-01"), subtotal: 100, taxTotal: 8, rates: [] })).toBeNull()
  })
})
