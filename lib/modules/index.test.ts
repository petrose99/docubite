import { describe, expect, it } from "vitest"
import { INDUSTRIES } from "@/lib/modules"
import { findModule, modulesForIndustry, MODULES } from "@/lib/modules"
import { INDUSTRIES as INDUSTRY_VALUES } from "@/types/industry"

describe("MODULES", () => {
  it("has unique keys", () => {
    const keys = MODULES.map((mod) => mod.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("every module's industry is 'core' or a real Industry value", () => {
    for (const mod of MODULES) {
      expect(mod.industry === "core" || (INDUSTRY_VALUES as readonly string[]).includes(mod.industry)).toBe(true)
    }
  })

  it("no module targets 'general' — general workspaces get core only", () => {
    expect(MODULES.some((mod) => mod.industry === "general")).toBe(false)
  })

  it("every navItems href is a relative path (no leading slash, no absolute URL)", () => {
    for (const mod of MODULES) {
      for (const item of mod.navItems ?? []) {
        expect(item.href.startsWith("/")).toBe(false)
        expect(item.href).not.toMatch(/^https?:\/\//)
      }
    }
  })

  it("core modules are all 'always' tier", () => {
    for (const mod of MODULES.filter((m) => m.industry === "core")) {
      expect(mod.tier).toBe("always")
    }
  })
})

describe("findModule", () => {
  it("finds a known module by key", () => {
    expect(findModule("review-queue")?.name).toBe("Review queue")
  })

  it("returns null for an unknown key or nullish input", () => {
    expect(findModule("nope")).toBeNull()
    expect(findModule(null)).toBeNull()
    expect(findModule(undefined)).toBeNull()
  })
})

describe("modulesForIndustry", () => {
  it("includes every core module for any industry", () => {
    const coreKeys = MODULES.filter((m) => m.industry === "core").map((m) => m.key)
    for (const industry of INDUSTRIES.map((i) => i.key)) {
      const keys = modulesForIndustry(industry).map((m) => m.key)
      for (const key of coreKeys) expect(keys).toContain(key)
    }
  })

  it("a general workspace gets only core modules", () => {
    expect(modulesForIndustry("general").every((mod) => mod.industry === "core")).toBe(true)
  })

  it("never mixes another industry's modules in", () => {
    for (const mod of modulesForIndustry("finance")) {
      expect(mod.industry === "core" || mod.industry === "finance").toBe(true)
    }
  })
})

describe("INDUSTRIES", () => {
  it("has exactly the industries from types/industry.ts", () => {
    expect(INDUSTRIES.map((i) => i.key).sort()).toEqual([...INDUSTRY_VALUES].sort())
  })
})
