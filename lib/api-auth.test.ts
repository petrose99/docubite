import { describe, expect, it, vi } from "vitest"

// api-auth imports @/lib/db for its route wrapper; stub the client layer so the module loads. The
// core authenticateApiKey takes an injectable store, so the tests never touch the real DB.
vi.mock("@/lib/db", () => ({ prisma: { workspaceApiKey: {} } }))
vi.mock("@/prisma/client", () => ({ Prisma: {}, PrismaClient: vi.fn() }))

const { authenticateApiKey } = await import("./api-auth")
const { generateApiKey } = await import("./api-key")

const now = new Date("2026-08-26T12:00:00.000Z")

function storeReturning(row: any) {
  return { findUnique: vi.fn().mockResolvedValue(row), update: vi.fn().mockResolvedValue({}) }
}

describe("authenticateApiKey", () => {
  it("rejects a missing or malformed key before any lookup", async () => {
    const store = storeReturning(null)
    for (const h of [null, "Basic abc", "Bearer not-a-key", "Bearer dbk_test_" + "a".repeat(40)]) {
      const res = await authenticateApiKey(h, store, now)
      expect(res).toEqual({ ok: false, status: 401, errorCode: "missing_api_key" })
    }
    expect(store.findUnique).not.toHaveBeenCalled()
  })

  it("rejects a well-formed key that is not found", async () => {
    const key = generateApiKey()
    const res = await authenticateApiKey(`Bearer ${key.plaintext}`, storeReturning(null), now)
    expect(res).toEqual({ ok: false, status: 401, errorCode: "invalid_api_key" })
  })

  it("rejects a revoked key", async () => {
    const key = generateApiKey()
    const store = storeReturning({ id: "k1", workspaceId: "w1", revokedAt: new Date("2026-01-01"), lastUsedAt: now })
    const res = await authenticateApiKey(`Bearer ${key.plaintext}`, store, now)
    expect(res).toEqual({ ok: false, status: 401, errorCode: "revoked_api_key" })
  })

  it("authenticates a valid key and returns its workspace", async () => {
    const key = generateApiKey()
    const store = storeReturning({ id: "k1", workspaceId: "w1", revokedAt: null, lastUsedAt: now })
    const res = await authenticateApiKey(`Bearer ${key.plaintext}`, store, now)
    expect(res).toEqual({ ok: true, workspaceId: "w1", apiKeyId: "k1" })
    // looked up by hash, never by plaintext
    expect(store.findUnique.mock.calls[0][0].where.keyHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("bumps lastUsedAt only when stale", async () => {
    const key = generateApiKey()
    const fresh = storeReturning({ id: "k1", workspaceId: "w1", revokedAt: null, lastUsedAt: new Date(now.getTime() - 60_000) })
    await authenticateApiKey(`Bearer ${key.plaintext}`, fresh, now)
    expect(fresh.update).not.toHaveBeenCalled()

    const stale = storeReturning({ id: "k1", workspaceId: "w1", revokedAt: null, lastUsedAt: new Date(now.getTime() - 10 * 60_000) })
    await authenticateApiKey(`Bearer ${key.plaintext}`, stale, now)
    expect(stale.update).toHaveBeenCalledWith({ where: { id: "k1" }, data: { lastUsedAt: now } })

    const never = storeReturning({ id: "k1", workspaceId: "w1", revokedAt: null, lastUsedAt: null })
    await authenticateApiKey(`Bearer ${key.plaintext}`, never, now)
    expect(never.update).toHaveBeenCalledOnce()
  })
})
