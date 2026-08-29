import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { findBillByInvoiceNumber } from "@/lib/integrations/xero/client"

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })

describe("findBillByInvoiceNumber", () => {
  const originalFetch = global.fetch
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()) })
  afterEach(() => { global.fetch = originalFetch })

  it("returns true when the query finds an existing ACCPAY invoice", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ Invoices: [{ InvoiceID: "abc" }] }))
    expect(await findBillByInvoiceNumber("tenant1", "token1", "INV-1")).toBe(true)
  })

  it("returns false when nothing matches", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ Invoices: [] }))
    expect(await findBillByInvoiceNumber("tenant1", "token1", "INV-1")).toBe(false)
  })

  it("escapes double quotes in the invoice number before building the where clause", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ Invoices: [] }))
    await findBillByInvoiceNumber("tenant1", "token1", 'INV-"1"')
    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(decodeURIComponent(url)).toContain('InvoiceNumber=="INV-\\"1\\""')
  })
})
