import { describe, expect, it } from "vitest"
import { toBigcapitalBillBody } from "@/lib/integrations/bigcapital/bill-mapper"
import type { NormalizedBill } from "@/lib/integration-bill-mapping"

const bill: NormalizedBill = {
  documentId: "d1", filename: "invoice.pdf", vendorName: "Acme", referenceNumber: "INV-1",
  issueDate: "2026-08-01", dueDate: "2026-08-31", total: 40, currencyCode: null,
  lineItems: [{ description: "Widget", quantity: 2, unitPrice: 20, amount: 40 }],
}

describe("toBigcapitalBillBody", () => {
  it("omits currency_code when no currency code is known", () => {
    const body = toBigcapitalBillBody(bill, "1", "2")
    expect(body).not.toHaveProperty("currency_code")
  })

  it("includes currency_code when a currency code is present", () => {
    const body = toBigcapitalBillBody({ ...bill, currencyCode: "GBP" }, "1", "2")
    expect(body.currency_code).toBe("GBP")
  })

  it("codes every line item to the same item", () => {
    const body = toBigcapitalBillBody({
      ...bill,
      lineItems: [
        { description: "Widget", quantity: 2, unitPrice: 20, amount: 40 },
        { description: "Shipping", quantity: 1, unitPrice: 5, amount: 5 },
      ],
    }, "1", "42")
    expect(body.entries.every((entry) => entry.item_id === 42)).toBe(true)
    expect(body.entries.map((entry) => entry.index)).toEqual([1, 2])
  })

  it("falls back to today's date when the document has no issue date", () => {
    const body = toBigcapitalBillBody({ ...bill, issueDate: null }, "1", "2")
    expect(body.bill_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it("truncates a reference number longer than Bigcapital's bill_number limit", () => {
    const body = toBigcapitalBillBody({ ...bill, referenceNumber: "X".repeat(60) }, "1", "2")
    expect(body.bill_number?.length).toBe(50)
  })

  it("posts quantity 1 at the line's amount, not quantity/unitPrice, even when amount isn't quantity times unitPrice", () => {
    // Confirmed live: Bigcapital computes an entry's total as quantity × rate server-side, so
    // posting the extracted quantity/unitPrice instead of amount silently mis-totals a bill
    // whenever the two disagree (a discounted line, a rounding difference, a zero-quantity comp).
    const body = toBigcapitalBillBody({
      ...bill,
      lineItems: [{ description: "Discounted line", quantity: 2, unitPrice: 30, amount: 40 }],
    }, "1", "2")
    expect(body.entries[0].quantity).toBe(1)
    expect(body.entries[0].rate).toBe(40)
  })

  it("does not force a legitimate zero-quantity line item's amount to zero", () => {
    const body = toBigcapitalBillBody({
      ...bill,
      lineItems: [{ description: "Comped item", quantity: 0, unitPrice: 15, amount: 15 }],
    }, "1", "2")
    expect(body.entries[0].quantity).toBe(1)
    expect(body.entries[0].rate).toBe(15)
  })
})
