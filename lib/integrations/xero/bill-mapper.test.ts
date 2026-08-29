import { describe, expect, it } from "vitest"
import { toXeroBillBody } from "@/lib/integrations/xero/bill-mapper"
import type { NormalizedBill } from "@/lib/integration-bill-mapping"

const bill: NormalizedBill = {
  documentId: "d1", filename: "invoice.pdf", vendorName: "Acme", referenceNumber: "INV-1",
  issueDate: "2026-08-01", dueDate: "2026-08-31", total: 40, currencyCode: null,
  lineItems: [{ description: "Widget", quantity: 1, unitPrice: 40, amount: 40 }],
}

describe("toXeroBillBody", () => {
  it("omits CurrencyCode when no currency code is known", () => {
    const body = toXeroBillBody(bill, "c1", "a1")
    expect(body).not.toHaveProperty("CurrencyCode")
  })

  it("includes CurrencyCode when a currency code is present", () => {
    const body = toXeroBillBody({ ...bill, currencyCode: "GBP" }, "c1", "a1")
    expect(body.CurrencyCode).toBe("GBP")
  })
})
