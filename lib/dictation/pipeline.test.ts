import { describe, expect, it, vi } from "vitest"
import type { DictationRouting } from "@/lib/dictation/pipeline"
import type { RoutedIntent } from "@/lib/dictation/router"
import type { DictationExtraction } from "@/lib/dictation/extraction"

const dictationConfig = { routeThreshold: 0.65 }
vi.mock("@/lib/config", () => ({ default: { get dictation() { return dictationConfig } } }))

const { resolveDictationRouting, checkDictationAmbiguity, AMBIGUITY_MARGIN } = await import("@/lib/dictation/pipeline")

const extraction = (over: Partial<DictationExtraction> = {}): DictationExtraction => ({
  requested_format: null, format_source: "inferred", commands: [], cleaned_content: "content", ...over,
})

const routedTemplate: RoutedIntent = { intent: "template", route: null, score: 0, via: "template" }
const routedMatch: RoutedIntent = {
  intent: "finance_record",
  route: { name: "finance_record", examples: [], defaultFormat: "table" },
  score: 0.9,
  via: "matched",
}
const routedGeneral: RoutedIntent = { intent: "general", route: null, score: 0, via: "below_threshold" }

describe("resolveDictationRouting", () => {
  it("uses the pre-selected template's default format when nothing was spoken", () => {
    const result = resolveDictationRouting({ preselectedTemplateFormat: "soap_note", routed: routedTemplate, extraction: extraction() })
    expect(result.format.name).toBe("soap_note")
    expect(result.formatSource).toBe("template_default")
  })

  it("a spoken explicit format overrides a pre-selected template", () => {
    const result = resolveDictationRouting({
      preselectedTemplateFormat: "soap_note",
      routed: routedTemplate,
      extraction: extraction({ requested_format: "table", format_source: "explicit" }),
    })
    expect(result.format.name).toBe("table")
    expect(result.formatSource).toBe("explicit")
  })

  it("uses the matched route's default format in agnostic mode with no spoken format", () => {
    const result = resolveDictationRouting({ routed: routedMatch, extraction: extraction() })
    expect(result.format.name).toBe("table")
    expect(result.formatSource).toBe("route_default")
  })

  it("a spoken explicit format overrides the route's default", () => {
    const result = resolveDictationRouting({
      routed: routedMatch,
      extraction: extraction({ requested_format: "email", format_source: "explicit" }),
    })
    expect(result.format.name).toBe("email")
    expect(result.formatSource).toBe("explicit")
  })

  it("falls back to the registry default when nothing routed and nothing was spoken", () => {
    const result = resolveDictationRouting({ routed: routedGeneral, extraction: extraction() })
    expect(result.format.name).toBe("narrative")
    expect(result.formatSource).toBe("fallback_default")
  })

  it("an explicit format naming an unknown name still resolves to something usable", () => {
    const result = resolveDictationRouting({
      routed: routedGeneral,
      // format_source "explicit" but requested_format somehow empty — the extraction layer's own
      // safeParse would already catch this, but the resolver must not crash on it either.
      extraction: extraction({ requested_format: null, format_source: "explicit" }),
    })
    expect(result.format.name).toBe("narrative")
    expect(result.formatSource).toBe("fallback_default")
  })

  it("carries spoken commands through regardless of which branch resolved the format", () => {
    const result = resolveDictationRouting({
      preselectedTemplateFormat: "narrative",
      routed: routedTemplate,
      extraction: extraction({ commands: ["make this a table"] }),
    })
    expect(result.commands).toEqual(["make this a table"])
  })
})

const routing = (over: Partial<DictationRouting> = {}): DictationRouting => ({
  intent: "finance_record",
  format: { name: "table", label: "Table", sections: [] },
  formatSource: "route_default",
  routeScore: 0.9,
  routeVia: "matched",
  commands: [],
  ...over,
})

describe("checkDictationAmbiguity", () => {
  it("is not ambiguous on a clean, confident match", () => {
    expect(checkDictationAmbiguity(routing({ routeScore: 0.9, routeVia: "matched" }))).toEqual({ ambiguous: false, reason: null })
  })

  it("flags a score just above the threshold as an intent near-miss", () => {
    const score = dictationConfig.routeThreshold + AMBIGUITY_MARGIN / 2
    expect(checkDictationAmbiguity(routing({ routeScore: score, routeVia: "matched" }))).toEqual({ ambiguous: true, reason: "intent" })
  })

  it("flags a score just below the threshold as an intent near-miss", () => {
    const score = dictationConfig.routeThreshold - AMBIGUITY_MARGIN / 2
    expect(checkDictationAmbiguity(routing({ routeScore: score, routeVia: "below_threshold" }))).toEqual({ ambiguous: true, reason: "intent" })
  })

  it("does not flag a score clearly below the threshold, even though it fell through to general", () => {
    expect(checkDictationAmbiguity(routing({ routeScore: 0.1, routeVia: "below_threshold" }))).toEqual({ ambiguous: false, reason: null })
  })

  it("does not flag score margins for a router that never actually ran", () => {
    // via "disabled"/"not_configured"/"template" mean no real comparison happened — a score of 0
    // there is not a near-miss, it is simply absent.
    expect(checkDictationAmbiguity(routing({ routeScore: 0, routeVia: "disabled" }))).toEqual({ ambiguous: false, reason: null })
  })

  it("flags the fallback default format as an ambiguous guess", () => {
    expect(checkDictationAmbiguity(routing({ routeVia: "below_threshold", routeScore: 0.1, formatSource: "fallback_default" }))).toEqual({ ambiguous: true, reason: "format" })
  })

  it("prefers the intent reason when both are true at once", () => {
    const score = dictationConfig.routeThreshold + AMBIGUITY_MARGIN / 2
    expect(checkDictationAmbiguity(routing({ routeScore: score, routeVia: "matched", formatSource: "fallback_default" }))).toEqual({ ambiguous: true, reason: "intent" })
  })

  it("does not flag an explicit spoken format even with a weak route", () => {
    expect(checkDictationAmbiguity(routing({ routeScore: 0.1, routeVia: "below_threshold", formatSource: "explicit" }))).toEqual({ ambiguous: false, reason: null })
  })
})
