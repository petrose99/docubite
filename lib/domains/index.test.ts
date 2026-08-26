import { describe, expect, it } from "vitest"
import { extractionDomainPacks, findExtractionDomainPack } from "@/lib/domains"

describe("extractionDomainPacks", () => {
  it("offers pathology and logistics, but not finance or general", () => {
    const domains = extractionDomainPacks().map((pack) => pack.domain)
    expect(domains).toEqual(["pathology", "logistics"])
  })

  it("each pack carries the adapters for its own domain only", () => {
    for (const pack of extractionDomainPacks()) {
      expect(pack.adapters.length).toBeGreaterThan(0)
      expect(pack.adapters.every((adapter) => adapter.domain === pack.domain)).toBe(true)
    }
  })
})

describe("findExtractionDomainPack", () => {
  it("finds a known pack by domain", () => {
    expect(findExtractionDomainPack("logistics")?.label).toBe("Logistics")
  })

  it("returns null for finance, general, or an unknown domain", () => {
    expect(findExtractionDomainPack("finance")).toBeNull()
    expect(findExtractionDomainPack("general")).toBeNull()
    expect(findExtractionDomainPack("nope")).toBeNull()
  })
})
