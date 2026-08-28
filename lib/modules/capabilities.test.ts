import { describe, expect, it } from "vitest"
import { resolveModules } from "@/lib/modules/capabilities"

const NO_CONFIG = { asr: false, integrations: false, embeddings: false }
const ALL_CONFIG = { asr: true, integrations: true, embeddings: true }
const NO_PLAN = { integrations: false }
const ALL_PLAN = { integrations: true }

describe("resolveModules", () => {
  it("finance workspace with no overrides gets core + finance defaults, no optionals", () => {
    const keys = resolveModules("finance", new Map(), ALL_CONFIG, ALL_PLAN).map((m) => m.key)
    expect(keys).toContain("documents")
    expect(keys).toContain("review-queue")
    expect(keys).not.toContain("statement-packs")
    expect(keys).not.toContain("dictation")
  })

  it("general workspace gets only core, regardless of overrides", () => {
    const keys = resolveModules("general", new Map([["review-queue", "enabled"]]), ALL_CONFIG, ALL_PLAN).map((m) => m.key)
    expect(keys.sort()).toEqual(["assistant", "documents", "reports", "search", "sheets"])
  })

  it("'disabled' turns off a default-tier module", () => {
    const keys = resolveModules("finance", new Map([["review-queue", "disabled"]]), ALL_CONFIG, ALL_PLAN).map((m) => m.key)
    expect(keys).not.toContain("review-queue")
  })

  it("'disabled' cannot turn off an always-tier module", () => {
    const keys = resolveModules("finance", new Map([["documents", "disabled"]]), ALL_CONFIG, ALL_PLAN).map((m) => m.key)
    expect(keys).toContain("documents")
  })

  it("'enabled' turns on an optional-tier module", () => {
    const keys = resolveModules("finance", new Map([["statement-packs", "enabled"]]), ALL_CONFIG, ALL_PLAN).map((m) => m.key)
    expect(keys).toContain("statement-packs")
  })

  it("'requested' grants no capability by itself", () => {
    const keys = resolveModules("finance", new Map([["expense-approvals", "requested"]]), ALL_CONFIG, ALL_PLAN).map((m) => m.key)
    expect(keys).not.toContain("expense-approvals")
  })

  it("an override for another industry's module is ignored", () => {
    const keys = resolveModules("finance", new Map([["dictation", "enabled"]]), ALL_CONFIG, ALL_PLAN).map((m) => m.key)
    expect(keys).not.toContain("dictation")
  })

  it("drops a module whose requiresConfig prerequisite isn't met, even though it's 'default' tier", () => {
    const keys = resolveModules("healthcare", new Map(), NO_CONFIG, ALL_PLAN).map((m) => m.key)
    expect(keys).not.toContain("dictation")
    expect(keys).toContain("clinical-packs")
  })

  it("drops a module whose requiresPlanFlag prerequisite isn't met", () => {
    const keys = resolveModules("finance", new Map(), ALL_CONFIG, NO_PLAN).map((m) => m.key)
    expect(keys).not.toContain("accounting-push")
  })

  it("accounting-push needs both config and plan flag", () => {
    expect(resolveModules("finance", new Map(), ALL_CONFIG, ALL_PLAN).map((m) => m.key)).toContain("accounting-push")
    expect(resolveModules("finance", new Map(), NO_CONFIG, ALL_PLAN).map((m) => m.key)).not.toContain("accounting-push")
  })
})
