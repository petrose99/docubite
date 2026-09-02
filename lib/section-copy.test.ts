import { describe, expect, it } from "vitest"
import { SECTION_COPY, ONBOARDING_STEPS, TOUR_STEPS, type SectionKey } from "./section-copy"

describe("SECTION_COPY", () => {
  const keys: SectionKey[] = ["extraction", "library", "sheets", "dashboard"]

  it("every section key has a banner and howItWorks", () => {
    for (const key of keys) {
      const copy = SECTION_COPY[key]
      expect(copy).toBeDefined()
      expect(copy.banner).toBeTruthy()
      expect(copy.howItWorks.length).toBeGreaterThanOrEqual(2)
      for (const step of copy.howItWorks) {
        expect(step).toBeTruthy()
      }
    }
  })

  it("banners end with a period", () => {
    for (const key of keys) {
      expect(SECTION_COPY[key].banner.endsWith(".")).toBe(true)
    }
  })
})

describe("ONBOARDING_STEPS", () => {
  it("has exactly 5 steps", () => {
    expect(ONBOARDING_STEPS).toHaveLength(5)
  })

  it("every step has a unique key", () => {
    const keys = ONBOARDING_STEPS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("every step references a valid section", () => {
    const validSections: SectionKey[] = ["extraction", "library", "sheets", "dashboard"]
    for (const step of ONBOARDING_STEPS) {
      expect(validSections).toContain(step.section)
    }
  })
})

describe("TOUR_STEPS", () => {
  it("has 4 steps", () => {
    expect(TOUR_STEPS).toHaveLength(4)
  })

  it("every step has a target, title, and description", () => {
    for (const step of TOUR_STEPS) {
      expect(step.target).toBeTruthy()
      expect(step.title).toBeTruthy()
      expect(step.description).toBeTruthy()
    }
  })
})
