import { describe, expect, it } from "vitest"
import { applyRules, type AutomationRuleInput, type ExtractionForMatch } from "@/lib/automation/rules"

const rule = (overrides: Partial<AutomationRuleInput> = {}): AutomationRuleInput => ({
  id: "r1",
  matcher: { type: "exact", value: "Acme Supplies" },
  actions: { codingData: { account: "6000" } },
  minConfidence: null,
  requireReview: false,
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
})

const extraction = (overrides: Partial<ExtractionForMatch> = {}): ExtractionForMatch => ({
  templateCode: "invoice",
  supplierValue: "Acme Supplies",
  supplierConfidence: 0.95,
  ...overrides,
})

describe("applyRules — matching", () => {
  it("matches an exact rule case-insensitively and with surrounding whitespace trimmed", () => {
    const result = applyRules([rule({ matcher: { type: "exact", value: "  acme supplies  " } })], extraction())
    expect(result.ruleId).toBe("r1")
    expect(result.codingData).toEqual({ account: "6000" })
  })

  it("does not match an exact rule on a partial supplier name", () => {
    const result = applyRules([rule()], extraction({ supplierValue: "Acme Supplies Ltd" }))
    expect(result.ruleId).toBeNull()
  })

  it("matches a contains rule on a partial supplier name", () => {
    const result = applyRules([rule({ matcher: { type: "contains", value: "acme" } })], extraction({ supplierValue: "Acme Supplies Ltd" }))
    expect(result.ruleId).toBe("r1")
  })

  it("never matches an empty matcher value", () => {
    const result = applyRules([rule({ matcher: { type: "contains", value: "   " } })], extraction())
    expect(result.ruleId).toBeNull()
  })

  it("never matches when the document has no supplier value at all", () => {
    const result = applyRules([rule()], extraction({ supplierValue: null }))
    expect(result.ruleId).toBeNull()
  })

  it("ignores an inactive rule", () => {
    const result = applyRules([rule({ isActive: false })], extraction())
    expect(result.ruleId).toBeNull()
  })

  it("restricts a rule to its declared template codes", () => {
    const rules = [rule({ matcher: { type: "exact", value: "Acme Supplies", templateCodes: ["receipt"] } })]
    expect(applyRules(rules, extraction({ templateCode: "invoice" })).ruleId).toBeNull()
    expect(applyRules(rules, extraction({ templateCode: "receipt" })).ruleId).toBe("r1")
  })

  it("applies a rule with no templateCodes to every template", () => {
    const result = applyRules([rule({ matcher: { type: "exact", value: "Acme Supplies", templateCodes: undefined } })], extraction({ templateCode: "expense_receipt" }))
    expect(result.ruleId).toBe("r1")
  })
})

describe("applyRules — deterministic precedence", () => {
  it("prefers an exact match over a contains match regardless of order or recency", () => {
    const exact = rule({ id: "exact", matcher: { type: "exact", value: "Acme Supplies" }, createdAt: new Date("2026-06-01") })
    const contains = rule({ id: "contains", matcher: { type: "contains", value: "acme" }, createdAt: new Date("2026-01-01") })
    expect(applyRules([contains, exact], extraction()).ruleId).toBe("exact")
    expect(applyRules([exact, contains], extraction()).ruleId).toBe("exact")
  })

  it("prefers the older of two equally-typed matching rules", () => {
    const older = rule({ id: "older", createdAt: new Date("2026-01-01") })
    const newer = rule({ id: "newer", createdAt: new Date("2026-06-01") })
    expect(applyRules([newer, older], extraction()).ruleId).toBe("older")
    expect(applyRules([older, newer], extraction()).ruleId).toBe("older")
  })

  it("is stable across every permutation of three tied-type matches", () => {
    const a = rule({ id: "a", createdAt: new Date("2026-01-01") })
    const b = rule({ id: "b", createdAt: new Date("2026-02-01") })
    const c = rule({ id: "c", createdAt: new Date("2026-03-01") })
    for (const permutation of [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]]) {
      expect(applyRules(permutation, extraction()).ruleId).toBe("a")
    }
  })
})

describe("applyRules — review reasons", () => {
  it("flags low_confidence when the match's confidence is below the rule's floor", () => {
    const result = applyRules([rule({ minConfidence: 0.9 })], extraction({ supplierConfidence: 0.5 }))
    expect(result.ruleId).toBe("r1")
    expect(result.reviewReason).toBe("low_confidence")
  })

  it("does not flag low_confidence when the rule sets no minConfidence", () => {
    const result = applyRules([rule({ minConfidence: null })], extraction({ supplierConfidence: 0.01 }))
    expect(result.reviewReason).toBeNull()
  })

  it("flags rule_required when the matched rule demands review, confidence notwithstanding", () => {
    const result = applyRules([rule({ requireReview: true, minConfidence: null })], extraction({ supplierConfidence: 0.99 }))
    expect(result.reviewReason).toBe("rule_required")
  })

  it("low_confidence takes precedence over rule_required when both would apply", () => {
    const result = applyRules([rule({ requireReview: true, minConfidence: 0.9 })], extraction({ supplierConfidence: 0.1 }))
    expect(result.reviewReason).toBe("low_confidence")
  })

  it("flags no_match_risky when rules exist for this template but none matched", () => {
    const result = applyRules([rule()], extraction({ supplierValue: "Totally Different Co" }))
    expect(result.ruleId).toBeNull()
    expect(result.reviewReason).toBe("no_match_risky")
  })

  it("does not flag no_match_risky when the workspace has no rules at all", () => {
    const result = applyRules([], extraction())
    expect(result.reviewReason).toBeNull()
  })

  it("does not flag no_match_risky when the only rules are for a different template", () => {
    const result = applyRules([rule({ matcher: { type: "exact", value: "Acme Supplies", templateCodes: ["receipt"] } })], extraction({ templateCode: "invoice" }))
    expect(result.reviewReason).toBeNull()
  })
})
