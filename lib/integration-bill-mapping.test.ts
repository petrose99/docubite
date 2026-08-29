import { BillMappingError, normalizeBillFromDocument } from "@/lib/integration-bill-mapping"
import { describe, expect, it } from "vitest"

const makeDoc = (overrides: Partial<Parameters<typeof normalizeBillFromDocument>[0]> = {}) => ({
  documentId: "doc1",
  filename: "invoice.pdf",
  templateCode: "invoice",
  reviewedData: {
    vendor: "Acme Corp",
    invoice_number: "INV-1",
    issue_date: "2026-08-01",
    due_date: "2026-08-31",
    total: 42.5,
    line_items: [{ description: "Widget", quantity: 2, unit_price: 20, amount: 40 }, { description: "Tax", amount: 2.5 }],
  },
  ...overrides,
})

describe("normalizeBillFromDocument", () => {
  it("reads vendor/invoice fields for an invoice", () => {
    const bill = normalizeBillFromDocument(makeDoc())
    expect(bill.vendorName).toBe("Acme Corp")
    expect(bill.referenceNumber).toBe("INV-1")
    expect(bill.issueDate).toBe("2026-08-01")
    expect(bill.dueDate).toBe("2026-08-31")
    expect(bill.total).toBe(42.5)
    expect(bill.lineItems).toHaveLength(2)
    expect(bill.lineItems[0]).toEqual({ description: "Widget", quantity: 2, unitPrice: 20, amount: 40 })
  })

  it("reads merchant/receipt fields for a receipt, with no due date", () => {
    const bill = normalizeBillFromDocument(makeDoc({
      templateCode: "receipt",
      reviewedData: { merchant: "Store", receipt_number: "R-9", purchase_date: "2026-08-10", due_date: "2026-08-20", total: 12 },
    }))
    expect(bill.vendorName).toBe("Store")
    expect(bill.referenceNumber).toBe("R-9")
    expect(bill.issueDate).toBe("2026-08-10")
    expect(bill.dueDate).toBeNull()
  })

  it("synthesizes one line item covering the total when line_items is empty", () => {
    const bill = normalizeBillFromDocument(makeDoc({ reviewedData: { vendor: "Acme", total: 99, line_items: [] } }))
    expect(bill.lineItems).toEqual([{ description: "Total", quantity: 1, unitPrice: 99, amount: 99 }])
  })

  it("synthesizes one line item when line_items is missing entirely", () => {
    const bill = normalizeBillFromDocument(makeDoc({ reviewedData: { vendor: "Acme", total: 50 } }))
    expect(bill.lineItems).toEqual([{ description: "Total", quantity: 1, unitPrice: 50, amount: 50 }])
  })

  it("falls back to 'Unknown vendor' when no vendor/merchant is present", () => {
    const bill = normalizeBillFromDocument(makeDoc({ reviewedData: { total: 5 } }))
    expect(bill.vendorName).toBe("Unknown vendor")
  })

  it("throws BillMappingError when total is missing", () => {
    expect(() => normalizeBillFromDocument(makeDoc({ reviewedData: { vendor: "Acme" } }))).toThrow(BillMappingError)
  })

  it("throws BillMappingError when total is not a finite number", () => {
    expect(() => normalizeBillFromDocument(makeDoc({ reviewedData: { vendor: "Acme", total: Number.NaN } }))).toThrow(BillMappingError)
  })

  it("reads a valid 3-letter currency code, uppercased", () => {
    const bill = normalizeBillFromDocument(makeDoc({ reviewedData: { vendor: "Acme", total: 5, currency_code: "usd" } }))
    expect(bill.currencyCode).toBe("USD")
  })

  it("returns null currency code when absent or malformed", () => {
    expect(normalizeBillFromDocument(makeDoc({ reviewedData: { vendor: "Acme", total: 5 } })).currencyCode).toBeNull()
    expect(normalizeBillFromDocument(makeDoc({ reviewedData: { vendor: "Acme", total: 5, currency_code: "US" } })).currencyCode).toBeNull()
    expect(normalizeBillFromDocument(makeDoc({ reviewedData: { vendor: "Acme", total: 5, currency_code: "USDOLLAR" } })).currencyCode).toBeNull()
  })
})
