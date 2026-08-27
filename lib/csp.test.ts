import { describe, expect, it } from "vitest"
import { buildCsp, generateNonce } from "@/lib/csp"

describe("generateNonce", () => {
  it("returns a base64 string, different on every call", () => {
    const a = generateNonce()
    const b = generateNonce()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })
})

describe("buildCsp", () => {
  it("embeds the nonce in script-src alongside strict-dynamic", () => {
    const csp = buildCsp("test-nonce")
    expect(csp).toContain("script-src 'self' 'nonce-test-nonce' 'strict-dynamic'")
  })

  it("keeps style-src permissive for Tailwind's runtime injection", () => {
    expect(buildCsp("n")).toContain("style-src 'self' 'unsafe-inline'")
  })

  it("locks down framing, base and object sources", () => {
    const csp = buildCsp("n")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("object-src 'none'")
  })

  it("points violation reports at the app's own report route", () => {
    expect(buildCsp("n")).toContain("report-uri /api/csp-report")
  })
})
