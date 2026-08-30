import { describe, expect, it } from "vitest"
import { resolveModules } from "@/lib/modules/capabilities"

const NO_CONFIG = { asr: false, integrations: false, embeddings: false }
const ALL_CONFIG = { asr: true, integrations: true, embeddings: true }

describe("resolveModules", () => {
  it("finance workspace with no overrides gets core plus every finance module — everything is tier 'always' now", () => {
    const keys = resolveModules("finance", new Map(), ALL_CONFIG).map((m) => m.key)
    expect(keys).toContain("documents")
    expect(keys).toContain("review-queue")
    expect(keys).toContain("statement-packs")
    expect(keys).toContain("dictation")
    expect(keys).toContain("accounting-push")
  })

  it("'disabled' cannot turn off an always-tier module — every finance module is 'always'", () => {
    const keys = resolveModules("finance", new Map([["review-queue", "disabled"]]), ALL_CONFIG).map((m) => m.key)
    expect(keys).toContain("review-queue")
  })

  it("'disabled' cannot turn off a core always-tier module either", () => {
    const keys = resolveModules("finance", new Map([["documents", "disabled"]]), ALL_CONFIG).map((m) => m.key)
    expect(keys).toContain("documents")
  })

  it("drops a module whose requiresConfig prerequisite isn't met, even though it's 'always' tier", () => {
    const keys = resolveModules("finance", new Map(), NO_CONFIG).map((m) => m.key)
    expect(keys).not.toContain("dictation")
    expect(keys).not.toContain("accounting-push")
    expect(keys).toContain("review-queue")
  })

  it("dictation is available once ASR config is present", () => {
    const keys = resolveModules("finance", new Map(), ALL_CONFIG).map((m) => m.key)
    expect(keys).toContain("dictation")
  })
})
