import { describe, expect, it } from "vitest"
import { INDUSTRIES } from "@/types/industry"
import { seedTemplatesForIndustry } from "@/lib/modules/seeds"

describe("seedTemplatesForIndustry", () => {
  it("returns a non-empty template list for every industry", () => {
    for (const industry of INDUSTRIES) {
      expect(seedTemplatesForIndustry(industry).length).toBeGreaterThan(0)
    }
  })

  it("every returned list includes the shared generic template except finance's own set", () => {
    for (const industry of INDUSTRIES) {
      const codes = seedTemplatesForIndustry(industry).map((template) => template.code)
      expect(codes).toContain("generic")
    }
  })

  it("finance gets its own four templates, unchanged", () => {
    expect(seedTemplatesForIndustry("finance").map((template) => template.code)).toEqual(["invoice", "receipt", "expense_receipt", "generic"])
  })

  it("general gets only invoice, receipt and generic — no expense_receipt", () => {
    expect(seedTemplatesForIndustry("general").map((template) => template.code).sort()).toEqual(["generic", "invoice", "receipt"])
  })

  it("construction gets its own pack plus generic", () => {
    const codes = seedTemplatesForIndustry("construction").map((template) => template.code)
    expect(codes).toContain("subcontractor_invoice")
    expect(codes).toContain("generic")
  })
})
