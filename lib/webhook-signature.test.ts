import { describe, expect, it } from "vitest"
import {
  buildSignatureHeader,
  computeSignature,
  parseSignatureHeader,
  verifySignature,
} from "./webhook-signature"

const secret = "whsec_test_secret"
const body = JSON.stringify({ id: "evt_1", type: "document.reviewed" })
const t = 1_700_000_000

describe("signature round-trip", () => {
  it("a freshly built header verifies against the same body and secret", () => {
    const header = buildSignatureHeader(secret, t, body)
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/)
    expect(verifySignature(secret, body, header, { now: t })).toBe(true)
  })

  it("is deterministic for the same inputs (retries resend identical bytes)", () => {
    expect(computeSignature(secret, t, body)).toBe(computeSignature(secret, t, body))
  })
})

describe("verifySignature rejects", () => {
  const header = buildSignatureHeader(secret, t, body)

  it("a wrong secret", () => {
    expect(verifySignature("whsec_other", body, header, { now: t })).toBe(false)
  })

  it("a tampered body", () => {
    expect(verifySignature(secret, body + " ", header, { now: t })).toBe(false)
  })

  it("a stale timestamp beyond tolerance", () => {
    expect(verifySignature(secret, body, header, { now: t + 301 })).toBe(false)
    expect(verifySignature(secret, body, header, { now: t + 299 })).toBe(true)
  })

  it("a future timestamp beyond tolerance (clock skew both directions)", () => {
    expect(verifySignature(secret, body, header, { now: t - 301 })).toBe(false)
  })

  it("a malformed or timestamp-less header", () => {
    for (const bad of ["", "garbage", "v1=abc", "t=,v1=abc", "t=notanumber,v1=abc"]) {
      expect(verifySignature(secret, body, bad, { now: t })).toBe(false)
    }
  })
})

describe("parseSignatureHeader", () => {
  it("reads t and collects multiple v1 values (rotation)", () => {
    const parsed = parseSignatureHeader("t=123,v1=aaa,v1=bbb,v2=ignored")
    expect(parsed).toEqual({ timestamp: 123, v1: ["aaa", "bbb"] })
  })

  it("accepts either of two valid secrets during rotation", () => {
    const s1 = computeSignature("secret1", t, body)
    const s2 = computeSignature("secret2", t, body)
    const header = `t=${t},v1=${s1},v1=${s2}`
    expect(verifySignature("secret1", body, header, { now: t })).toBe(true)
    expect(verifySignature("secret2", body, header, { now: t })).toBe(true)
    expect(verifySignature("secret3", body, header, { now: t })).toBe(false)
  })
})
