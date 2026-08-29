import { describe, expect, it } from "vitest"
import { toQuickBooksBillBody } from "@/lib/integrations/quickbooks/bill-mapper"
import type { NormalizedBill } from "@/lib/integration-bill-mapping"

const bill: NormalizedBill = {
  documentId: "d1", filename: "invoice.pdf", vendorName: "Acme", referenceNumber: "INV-1",
  issueDate: "2026-08-01", dueDate: "2026-08-31", total: 40, currencyCode: null,
  lineItems: [{ description: "Widget", quantity: 1, unitPrice: 40, amount: 40 }],
}

describe("toQuickBooksBillBody", () => {
  it("omits CurrencyRef when no currency code is known", () => {
    const body = toQuickBooksBillBody(bill, "v1", "a1")
    expect(body).not.toHaveProperty("CurrencyRef")
  })

  it("includes CurrencyRef when a currency code is present", () => {
    const body = toQuickBooksBillBody({ ...bill, currencyCode: "GBP" }, "v1", "a1")
    expect(body.CurrencyRef).toEqual({ value: "GBP" })
  })
})
