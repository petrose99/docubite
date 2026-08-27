import { describe, expect, it } from "vitest"
import { TAX_REGIONS, TAX_REGION_LIST, getTaxRegion } from "@/lib/tax/regions"
import { TAX_REGION_CODES, taxRegionConfigSchema } from "@/lib/tax/types"

describe("TAX_REGIONS", () => {
  it("has exactly the four launch regions, each keyed to its own code", () => {
    expect(Object.keys(TAX_REGIONS).sort()).toEqual([...TAX_REGION_CODES].sort())
    for (const code of TAX_REGION_CODES) expect(TAX_REGIONS[code].region).toBe(code)
  })

  it("validates every region against the schema", () => {
    for (const region of TAX_REGION_LIST) expect(() => taxRegionConfigSchema.parse(region)).not.toThrow()
  })

  it("gives South Africa a single 15% VAT rate", () => {
    const za = getTaxRegion("za")
    expect(za.taxType).toBe("vat")
    expect(za.rates).toEqual([expect.objectContaining({ rate: 0.15 })])
  })

  it("gives the UK its three-tier VAT structure", () => {
    const gb = getTaxRegion("gb")
    expect(gb.rates.map((rate) => rate.rate).sort((a, b) => b - a)).toEqual([0.20, 0.05, 0])
  })

  it("leaves US rates empty rather than asserting a single wrong number", () => {
    const us = getTaxRegion("us")
    expect(us.taxType).toBe("sales_tax")
    expect(us.rates).toEqual([])
    expect(us.form1099Fields.length).toBeGreaterThan(0)
  })

  it("gives every VAT region at least one rate", () => {
    for (const region of TAX_REGION_LIST) if (region.taxType === "vat") expect(region.rates.length).toBeGreaterThan(0)
  })
})
