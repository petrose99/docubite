import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/config", () => ({ default: { auth: { idleTimeoutMinutes: 15 }, supabase: { url: "https://x.supabase.co", anonKey: "key" } } }))

const { isIdle } = await import("@/lib/supabase/middleware")

function fakeRequest(lastSeenValue: string | undefined): Parameters<typeof isIdle>[0] {
  return {
    cookies: { get: (name: string) => (name === "docubite-last-seen" && lastSeenValue !== undefined ? { value: lastSeenValue } : undefined) },
  } as never
}

describe("isIdle", () => {
  it("is not idle when there is no last-seen cookie yet (first request on a session)", () => {
    expect(isIdle(fakeRequest(undefined))).toBe(false)
  })

  it("is not idle within the configured window", () => {
    const tenMinutesAgo = Date.now() - 10 * 60_000
    expect(isIdle(fakeRequest(String(tenMinutesAgo)))).toBe(false)
  })

  it("is idle past the configured window", () => {
    const twentyMinutesAgo = Date.now() - 20 * 60_000
    expect(isIdle(fakeRequest(String(twentyMinutesAgo)))).toBe(true)
  })

  it("treats a malformed cookie value as not idle rather than throwing", () => {
    expect(isIdle(fakeRequest("not-a-number"))).toBe(false)
  })

  it("is not idle when the user signed in after the stale last-seen timestamp (fresh login)", () => {
    const twentyMinutesAgo = Date.now() - 20 * 60_000
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString()
    expect(isIdle(fakeRequest(String(twentyMinutesAgo)), oneMinuteAgo)).toBe(false)
  })

  it("is still idle when the sign-in predates the stale last-seen timestamp", () => {
    const twentyMinutesAgo = Date.now() - 20 * 60_000
    const anHourAgo = new Date(Date.now() - 60 * 60_000).toISOString()
    expect(isIdle(fakeRequest(String(twentyMinutesAgo)), anHourAgo)).toBe(true)
  })

  it("ignores an unparseable last_sign_in_at rather than throwing", () => {
    const twentyMinutesAgo = Date.now() - 20 * 60_000
    expect(isIdle(fakeRequest(String(twentyMinutesAgo)), "not-a-date")).toBe(true)
  })
})
