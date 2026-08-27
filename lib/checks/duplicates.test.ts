import { describe, expect, it } from "vitest"
import { findNearDuplicate, type DocumentIdentity } from "@/lib/checks/duplicates"

const identity = (overrides: Partial<DocumentIdentity> = {}): DocumentIdentity => ({
  documentId: "d1", supplier: "Acme Supplies", invoiceNumber: "INV-100", total: 500, currencyCode: "USD",
  ...overrides,
})

describe("findNearDuplicate", () => {
  it("returns null without a supplier, invoice number, or total", () => {
    expect(findNearDuplicate(identity({ supplier: null }), [])).toBeNull()
    expect(findNearDuplicate(identity({ invoiceNumber: "" }), [])).toBeNull()
    expect(findNearDuplicate(identity({ total: null }), [])).toBeNull()
  })

  it("passes with no other documents", () => {
    expect(findNearDuplicate(identity(), [])?.status).toBe("pass")
  })

  it("warns when another document matches supplier, invoice number, and total", () => {
    const other = identity({ documentId: "d2" })
    expect(findNearDuplicate(identity(), [other])?.status).toBe("warn")
  })

  it("matches case-insensitively and across surrounding whitespace", () => {
    const other = identity({ documentId: "d2", supplier: "  ACME SUPPLIES  ", invoiceNumber: " inv-100 " })
    expect(findNearDuplicate(identity(), [other])?.status).toBe("warn")
  })

  it("does not match itself", () => {
    expect(findNearDuplicate(identity(), [identity()])?.status).toBe("pass")
  })

  it("does not match a different invoice number from the same supplier", () => {
    const other = identity({ documentId: "d2", invoiceNumber: "INV-200" })
    expect(findNearDuplicate(identity(), [other])?.status).toBe("pass")
  })

  it("does not match the same supplier and invoice number with a materially different total", () => {
    const other = identity({ documentId: "d2", total: 700 })
    expect(findNearDuplicate(identity(), [other])?.status).toBe("pass")
  })

  it("tolerates rounding noise in the total", () => {
    const other = identity({ documentId: "d2", total: 500.001 })
    expect(findNearDuplicate(identity(), [other])?.status).toBe("warn")
  })
})
