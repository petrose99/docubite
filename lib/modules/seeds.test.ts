import { describe, expect, it } from "vitest"
import { INDUSTRIES } from "@/types/industry"
import { seedTemplatesForIndustry } from "@/lib/modules/seeds"

describe("seedTemplatesForIndustry", () => {
  it("returns a non-empty template list for every industry", () => {
    for (const industry of INDUSTRIES) {
      expect(seedTemplatesForIndustry(industry).length).toBeGreaterThan(0)
    }
  })

  it("every returned list includes the shared generic template", () => {
    for (const industry of INDUSTRIES) {
      const codes = seedTemplatesForIndustry(industry).map((template) => template.code)
      expect(codes).toContain("generic")
    }
  })

  it("finance gets its own four templates, unchanged — the app is finance-only", () => {
    expect(seedTemplatesForIndustry("finance").map((template) => template.code)).toEqual(["invoice", "receipt", "expense_receipt", "generic"])
  })
})
