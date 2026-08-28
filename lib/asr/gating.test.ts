import { beforeEach, describe, expect, it, vi } from "vitest"

const { asrEnabled } = vi.hoisted(() => ({ asrEnabled: { value: true } }))
vi.mock("@/lib/config", () => ({ default: { get asr() { return { enabled: asrEnabled.value } } } }))

const { isAsrAllowed } = await import("@/lib/asr/gating")

beforeEach(() => { asrEnabled.value = true })

describe("isAsrAllowed", () => {
  it("refuses everything when no ASR backend is configured", () => {
    asrEnabled.value = false
    expect(isAsrAllowed({ industry: "healthcare", hipaaMode: true, asrExternalAllowed: false })).toBe(false)
    expect(isAsrAllowed({ industry: "finance", hipaaMode: false, asrExternalAllowed: false })).toBe(false)
  })

  it("allows a non-healthcare workspace regardless of the BAA flag", () => {
    expect(isAsrAllowed({ industry: "finance", hipaaMode: false, asrExternalAllowed: false })).toBe(true)
  })

  it("allows a healthcare workspace with hipaaMode off, regardless of the BAA flag", () => {
    expect(isAsrAllowed({ industry: "healthcare", hipaaMode: false, asrExternalAllowed: false })).toBe(true)
  })

  it("refuses a healthcare, hipaaMode workspace with no confirmed BAA", () => {
    expect(isAsrAllowed({ industry: "healthcare", hipaaMode: true, asrExternalAllowed: false })).toBe(false)
  })

  it("allows a healthcare, hipaaMode workspace once the BAA is confirmed", () => {
    expect(isAsrAllowed({ industry: "healthcare", hipaaMode: true, asrExternalAllowed: true })).toBe(true)
  })
})
