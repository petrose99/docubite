import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { findBillByDocNumber, listAccounts, voidBill } from "@/lib/integrations/quickbooks/client"

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })

describe("listAccounts pagination", () => {
  const originalFetch = global.fetch

  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()) })
  afterEach(() => { global.fetch = originalFetch })

  it("stops after a page shorter than the page size", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ QueryResponse: { Account: [{ Id: "1", Name: "A", Active: true }] } }))
    const accounts = await listAccounts("realm1", "token1")
    expect(accounts).toEqual([{ id: "1", name: "A", active: true }])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("pages through startposition until a short page ends it", async () => {
    const fullPage = Array.from({ length: 200 }, (_, i) => ({ Id: String(i), Name: `Account ${i}`, Active: true }))
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ QueryResponse: { Account: fullPage } }))
      .mockResolvedValueOnce(jsonResponse({ QueryResponse: { Account: [{ Id: "200", Name: "Last", Active: true }] } }))

    const accounts = await listAccounts("realm1", "token1")

    expect(accounts).toHaveLength(201)
    expect(fetch).toHaveBeenCalledTimes(2)
    const secondCallUrl = vi.mocked(fetch).mock.calls[1][0] as string
    expect(decodeURIComponent(secondCallUrl)).toContain("startposition 201")
  })
})

describe("findBillByDocNumber", () => {
  const originalFetch = global.fetch
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()) })
  afterEach(() => { global.fetch = originalFetch })

  it("returns true when a bill with that DocNumber exists", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ QueryResponse: { Bill: [{ Id: "1" }] } }))
    expect(await findBillByDocNumber("realm1", "token1", "INV-1")).toBe(true)
  })

  it("returns false when nothing matches", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ QueryResponse: {} }))
    expect(await findBillByDocNumber("realm1", "token1", "INV-1")).toBe(false)
  })

  it("escapes single quotes in the doc number before building the query", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ QueryResponse: {} }))
    await findBillByDocNumber("realm1", "token1", "INV-O'Brien")
    const url = vi.mocked(fetch).mock.calls[0][0] as string
    expect(decodeURIComponent(url)).toContain("DocNumber = 'INV-O\\'Brien'")
  })
})

describe("voidBill", () => {
  const originalFetch = global.fetch
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()) })
  afterEach(() => { global.fetch = originalFetch })

  it("reads the bill's current SyncToken, then POSTs the void operation with it", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ QueryResponse: { Bill: [{ Id: "42", SyncToken: "3" }] } }))
      .mockResolvedValueOnce(jsonResponse({ Bill: { Id: "42" } }))

    await voidBill("realm1", "token1", "42")

    expect(fetch).toHaveBeenCalledTimes(2)
    const [voidUrl, voidInit] = vi.mocked(fetch).mock.calls[1]
    expect(voidUrl).toContain("/bill?operation=void")
    expect(JSON.parse((voidInit as RequestInit).body as string)).toEqual({ Id: "42", SyncToken: "3" })
  })

  it("throws when the bill isn't found", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ QueryResponse: {} }))
    await expect(voidBill("realm1", "token1", "42")).rejects.toThrow()
  })

  it("throws on a non-2xx void response, same as createBill", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ QueryResponse: { Bill: [{ Id: "42", SyncToken: "3" }] } }))
      .mockResolvedValueOnce(new Response("", { status: 500 }))
    await expect(voidBill("realm1", "token1", "42")).rejects.toThrow()
  })
})
