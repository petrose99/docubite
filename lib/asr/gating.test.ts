import { beforeEach, describe, expect, it, vi } from "vitest"

const { asrEnabled } = vi.hoisted(() => ({ asrEnabled: { value: true } }))
vi.mock("@/lib/config", () => ({ default: { get asr() { return { enabled: asrEnabled.value } } } }))

const { isAsrAllowed } = await import("@/lib/asr/gating")

beforeEach(() => { asrEnabled.value = true })

describe("isAsrAllowed", () => {
  it("refuses everything when no ASR backend is configured", () => {
    asrEnabled.value = false
    expect(isAsrAllowed({ productMode: "clinical", hipaaMode: true, asrExternalAllowed: false })).toBe(false)
    expect(isAsrAllowed({ productMode: "accounting", hipaaMode: false, asrExternalAllowed: false })).toBe(false)
  })

  it("allows a non-clinical workspace regardless of the BAA flag", () => {
    expect(isAsrAllowed({ productMode: "accounting", hipaaMode: false, asrExternalAllowed: false })).toBe(true)
  })

  it("allows a clinical workspace with hipaaMode off, regardless of the BAA flag", () => {
    expect(isAsrAllowed({ productMode: "clinical", hipaaMode: false, asrExternalAllowed: false })).toBe(true)
  })

  it("refuses a clinical, hipaaMode workspace with no confirmed BAA", () => {
    expect(isAsrAllowed({ productMode: "clinical", hipaaMode: true, asrExternalAllowed: false })).toBe(false)
  })

  it("allows a clinical, hipaaMode workspace once the BAA is confirmed", () => {
    expect(isAsrAllowed({ productMode: "clinical", hipaaMode: true, asrExternalAllowed: true })).toBe(true)
  })
})
