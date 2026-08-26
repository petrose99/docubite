import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/config", () => ({ default: { aws: { internalWorkerSecret: "test-secret-value" } } }))

const { signOAuthState, verifyOAuthState } = await import("./integration-oauth-state")

const now = new Date("2026-08-26T12:00:00.000Z")
const payload = { workspaceId: "w1", userId: "u1", provider: "quickbooks" as const, nonce: "abc123" }

describe("signOAuthState / verifyOAuthState", () => {
  it("round-trips a valid token", () => {
    const token = signOAuthState(payload, 600, now)
    expect(verifyOAuthState(token, now)).toEqual(payload)
  })

  it("rejects a tampered payload", () => {
    const token = signOAuthState(payload, 600, now)
    const [payloadB64, signature] = token.split(".")
    const tampered = Buffer.from(JSON.stringify({ ...payload, workspaceId: "w2", exp: Math.floor(now.getTime() / 1000) + 600 }), "utf8").toString("base64url")
    expect(verifyOAuthState(`${tampered}.${signature}`, now)).toBeNull()
    expect(payloadB64).toBeTruthy()
  })

  it("rejects an expired token", () => {
    const token = signOAuthState(payload, 600, now)
    const later = new Date(now.getTime() + 601_000)
    expect(verifyOAuthState(token, later)).toBeNull()
  })

  it("accepts a token right at the expiry boundary but not just after", () => {
    const token = signOAuthState(payload, 600, now)
    const atBoundary = new Date(now.getTime() + 600_000)
    expect(verifyOAuthState(token, atBoundary)).toEqual(payload)
  })

  it("rejects a token signed under a different secret", async () => {
    const token = signOAuthState(payload, 600, now)
    vi.resetModules()
    vi.doMock("@/lib/config", () => ({ default: { aws: { internalWorkerSecret: "a-different-secret" } } }))
    const { verifyOAuthState: verifyWithOtherSecret } = await import("./integration-oauth-state")
    expect(verifyWithOtherSecret(token, now)).toBeNull()
  })

  it("rejects malformed tokens", () => {
    expect(verifyOAuthState("not-a-real-token", now)).toBeNull()
    expect(verifyOAuthState("", now)).toBeNull()
    expect(verifyOAuthState("abc.def", now)).toBeNull()
  })
})
