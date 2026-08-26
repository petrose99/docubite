import { describe, expect, it } from "vitest"
import { apiKeyHashEquals, generateApiKey, hashApiKey, looksLikeApiKey, parseBearerToken } from "./api-key"

describe("generateApiKey", () => {
  it("produces a dbk_live_ key whose hash and label derive from it", () => {
    const key = generateApiKey()
    expect(key.plaintext).toMatch(/^dbk_live_[A-Za-z0-9_-]{40}$/)
    expect(key.keyHash).toBe(hashApiKey(key.plaintext))
    expect(key.keyHash).toMatch(/^[0-9a-f]{64}$/)
    expect(key.keyPrefix).toBe("dbk_live_" + key.plaintext.slice(9, 17))
    // The label must not leak the whole secret.
    expect(key.plaintext.startsWith(key.keyPrefix)).toBe(true)
    expect(key.keyPrefix.length).toBeLessThan(key.plaintext.length)
  })

  it("is unique across calls", () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(a.plaintext).not.toBe(b.plaintext)
    expect(a.keyHash).not.toBe(b.keyHash)
  })

  it("every generated key passes looksLikeApiKey", () => {
    for (let i = 0; i < 50; i++) expect(looksLikeApiKey(generateApiKey().plaintext)).toBe(true)
  })
})

describe("parseBearerToken", () => {
  it("extracts the token, case-insensitively", () => {
    expect(parseBearerToken("Bearer abc123")).toBe("abc123")
    expect(parseBearerToken("bearer   abc123  ")).toBe("abc123")
    expect(parseBearerToken("BEARER\tabc123")).toBe("abc123")
  })

  it("returns null for missing, malformed, or non-bearer headers", () => {
    for (const v of [null, undefined, "", "Basic abc", "Bearer", "Bearer ", "token abc"]) {
      expect(parseBearerToken(v)).toBeNull()
    }
  })
})

describe("looksLikeApiKey", () => {
  it("rejects wrong prefix, wrong length, and bad chars", () => {
    expect(looksLikeApiKey("dbk_test_" + "a".repeat(40))).toBe(false)
    expect(looksLikeApiKey("dbk_live_" + "a".repeat(39))).toBe(false)
    expect(looksLikeApiKey("dbk_live_" + "a".repeat(41))).toBe(false)
    expect(looksLikeApiKey("dbk_live_" + "!".repeat(40))).toBe(false)
    expect(looksLikeApiKey("random")).toBe(false)
  })
})

describe("apiKeyHashEquals", () => {
  it("is true for equal hashes, false otherwise", () => {
    const h = hashApiKey("x")
    expect(apiKeyHashEquals(h, hashApiKey("x"))).toBe(true)
    expect(apiKeyHashEquals(h, hashApiKey("y"))).toBe(false)
    expect(apiKeyHashEquals(h, "short")).toBe(false)
  })
})
