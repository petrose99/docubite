import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { voidBill } from "@/lib/integrations/bigcapital/client"

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("voidBill", () => {
  const originalFetch = global.fetch
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()) })
  afterEach(() => { global.fetch = originalFetch })

  it("DELETEs /api/bills/{id} with the api-key auth headers", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }))
    await voidBill("api-key-1", "org1", "42")

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toContain("/api/bills/42")
    expect((init as RequestInit).method).toBe("DELETE")
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.authorization).toBe("Bearer api-key-1")
    expect(headers["organization-id"]).toBe("org1")
  })

  it("throws on a non-2xx response, same as createBill", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, 500))
    await expect(voidBill("api-key-1", "org1", "42")).rejects.toThrow()
  })

  it("throws an auth error on a 401", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, 401))
    await expect(voidBill("api-key-1", "org1", "42")).rejects.toThrow()
  })
})
