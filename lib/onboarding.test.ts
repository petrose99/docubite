import { describe, expect, it } from "vitest"
import { DEFAULT_ONBOARDING_STATE, dismissOnboarding, isOnboardingComplete, markStep, markTourSeen } from "./onboarding"

describe("onboarding state helpers", () => {
  it("default state is not dismissed and has no completed steps", () => {
    expect(DEFAULT_ONBOARDING_STATE.dismissed).toBe(false)
    expect(DEFAULT_ONBOARDING_STATE.tourSeen).toBe(false)
    expect(DEFAULT_ONBOARDING_STATE.completedSteps).toEqual([])
  })

  it("markStep adds a step and is idempotent", () => {
    const s1 = markStep(DEFAULT_ONBOARDING_STATE, "upload")
    expect(s1.completedSteps).toEqual(["upload"])
    const s2 = markStep(s1, "upload")
    expect(s2).toBe(s1)
  })

  it("markTourSeen sets tourSeen", () => {
    const s = markTourSeen(DEFAULT_ONBOARDING_STATE)
    expect(s.tourSeen).toBe(true)
  })

  it("dismissOnboarding sets dismissed", () => {
    const s = dismissOnboarding(DEFAULT_ONBOARDING_STATE)
    expect(s.dismissed).toBe(true)
  })

  it("isOnboardingComplete returns true when all 5 steps are done", () => {
    let s = DEFAULT_ONBOARDING_STATE
    expect(isOnboardingComplete(s)).toBe(false)
    for (const step of ["upload", "approve", "find_library", "pull_sheet", "ask_question"] as const) {
      s = markStep(s, step)
    }
    expect(isOnboardingComplete(s)).toBe(true)
  })
})
