import { randomBytes } from "crypto"
import { describe, expect, it } from "vitest"
import {
  decryptWithKeys,
  encryptWithKey,
  needsReencryptionWithKeys,
  parseKey,
  SecretCryptoError,
} from "./secret-crypto"

const keyA = randomBytes(32)
const keyB = randomBytes(32)

describe("parseKey", () => {
  it("accepts a 32-byte base64 key", () => {
    const b64 = randomBytes(32).toString("base64")
    expect(parseKey(b64).length).toBe(32)
  })

  it("rejects an empty, wrong-length, or non-base64 key", () => {
    expect(() => parseKey("")).toThrow(SecretCryptoError)
    expect(() => parseKey(randomBytes(16).toString("base64"))).toThrow(SecretCryptoError)
    expect(() => parseKey(randomBytes(31).toString("base64"))).toThrow(SecretCryptoError)
  })
})

describe("encryptWithKey / decryptWithKeys", () => {
  it("round-trips a value", () => {
    const secret = "whsec_" + randomBytes(24).toString("hex")
    const sealed = encryptWithKey(secret, keyA)
    expect(sealed.startsWith("v1.")).toBe(true)
    expect(sealed).not.toContain(secret)
    expect(decryptWithKeys(sealed, [keyA])).toBe(secret)
  })

  it("round-trips empty string and unicode", () => {
    for (const secret of ["", "héllo 🌍 tokén", "a".repeat(4096)]) {
      expect(decryptWithKeys(encryptWithKey(secret, keyA), [keyA])).toBe(secret)
    }
  })

  it("produces a fresh IV each time (no deterministic ciphertext)", () => {
    const a = encryptWithKey("same", keyA)
    const b = encryptWithKey("same", keyA)
    expect(a).not.toBe(b)
    expect(decryptWithKeys(a, [keyA])).toBe("same")
    expect(decryptWithKeys(b, [keyA])).toBe("same")
  })

  it("fails to decrypt under the wrong key", () => {
    const sealed = encryptWithKey("secret", keyA)
    expect(() => decryptWithKeys(sealed, [keyB])).toThrow(SecretCryptoError)
  })

  it("fails on a tampered ciphertext (GCM auth)", () => {
    const parts = encryptWithKey("secret", keyA).split(".")
    const ctBuf = Buffer.from(parts[3], "base64url")
    ctBuf[0] ^= 0xff
    const tampered = [parts[0], parts[1], parts[2], ctBuf.toString("base64url")].join(".")
    expect(() => decryptWithKeys(tampered, [keyA])).toThrow(SecretCryptoError)
  })

  it("rejects a malformed envelope", () => {
    for (const bad of ["", "nope", "v2.a.b.c", "v1.a.b", encryptWithKey("x", keyA).replace("v1", "v9")]) {
      expect(() => decryptWithKeys(bad, [keyA])).toThrow(SecretCryptoError)
    }
  })
})

describe("rotation", () => {
  it("decrypts values sealed under either the current or previous key", () => {
    const underOld = encryptWithKey("old-secret", keyB)
    // Current=keyA, previous=keyB.
    expect(decryptWithKeys(underOld, [keyA, keyB])).toBe("old-secret")
    const underNew = encryptWithKey("new-secret", keyA)
    expect(decryptWithKeys(underNew, [keyA, keyB])).toBe("new-secret")
  })

  it("flags a value on the old key as needing re-encryption, but not one on the current key", () => {
    const underOld = encryptWithKey("v", keyB)
    const underCurrent = encryptWithKey("v", keyA)
    expect(needsReencryptionWithKeys(underOld, keyA)).toBe(true)
    expect(needsReencryptionWithKeys(underCurrent, keyA)).toBe(false)
  })
})
