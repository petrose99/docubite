import { describe, expect, it } from "vitest"
import { extractionDomainPacks, findExtractionDomainPack } from "@/lib/domains"
import { FINANCE_TEMPLATES } from "@/lib/domains/finance"

describe("extractionDomainPacks", () => {
  it("offers only finance, not general", () => {
    const domains = extractionDomainPacks().map((pack) => pack.domain)
    expect(domains).toEqual(["finance"])
  })

  it("each pack carries the adapters for its own domain only", () => {
    for (const pack of extractionDomainPacks()) {
      expect(pack.adapters.length).toBeGreaterThan(0)
      expect(pack.adapters.every((adapter) => adapter.domain === pack.domain)).toBe(true)
    }
  })

  it("excludes finance's seeded templates from its own pack — a file already has them", () => {
    const finance = extractionDomainPacks().find((pack) => pack.domain === "finance")
    const seededCodes = new Set(FINANCE_TEMPLATES.map((template) => template.code))
    expect(finance?.adapters.some((adapter) => seededCodes.has(adapter.code))).toBe(false)
  })
})

describe("findExtractionDomainPack", () => {
  it("finds a known pack by domain", () => {
    expect(findExtractionDomainPack("finance")?.label).toBe("Finance (optional)")
  })

  it("returns null for general or an unknown domain", () => {
    expect(findExtractionDomainPack("general")).toBeNull()
    expect(findExtractionDomainPack("nope")).toBeNull()
  })
})
