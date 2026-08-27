/** The supplier automation rule engine (WP11) — pure and deterministic on purpose. Given the same
 * rules and the same extraction, applyRules always picks the same rule, every time, so a "why did
 * this document get coded that way" question always has one answer, not one that depends on
 * database row order. Run in the worker post-extraction (lib/document-processing.ts); nothing
 * here touches Prisma. */

export type RuleMatcherType = "exact" | "contains"

export type RuleMatcher = {
  type: RuleMatcherType
  /** The supplier/merchant text to match against, compared case-insensitively with both sides
   * trimmed. Never matches when empty — an empty matcher is a misconfigured rule, not a wildcard. */
  value: string
  /** Template codes this rule applies to. Empty/undefined means every template. */
  templateCodes?: string[]
}

export type RuleActions = {
  /** account/taxCode/costCentre/project — whatever coding this rule assigns. Stored verbatim onto
   * Document.codingData; the engine does not interpret the keys. */
  codingData: Record<string, string | number>
}

export type AutomationRuleInput = {
  id: string
  matcher: RuleMatcher
  actions: RuleActions
  minConfidence: number | null
  requireReview: boolean
  isActive: boolean
  createdAt: Date
}

export type ExtractionForMatch = {
  templateCode: string
  /** The vendor/merchant field's extracted value, whichever the template calls it. Null when the
   * template has no such field or it wasn't read. */
  supplierValue: string | null
  /** The extracted confidence score (0-1) for that same field, if the caller has one. */
  supplierConfidence: number | null
}

export type ReviewReason = "low_confidence" | "rule_required" | "no_match_risky"

export type RuleApplicationResult = {
  ruleId: string | null
  codingData: Record<string, string | number> | null
  /** Non-null exactly when the caller should open a ReviewTask (WP10) for this document. */
  reviewReason: ReviewReason | null
}

/** Which field on each finance template (lib/domains/finance.ts) is the "supplier" a rule
 * matches against. Not every template has one — bank_statement has no counterparty field of that
 * shape, so it is deliberately absent and applyAutomationRules simply never matches on it. */
export const SUPPLIER_FIELD_BY_TEMPLATE: Record<string, string> = {
  invoice: "vendor",
  receipt: "merchant",
  expense_receipt: "merchant",
  purchase_order: "supplier",
  remittance_advice: "payee",
  supplier_statement: "supplier",
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function isEligible(rule: AutomationRuleInput, templateCode: string): boolean {
  if (!rule.isActive) return false
  if (!rule.matcher.templateCodes?.length) return true
  return rule.matcher.templateCodes.includes(templateCode)
}

function isMatch(rule: AutomationRuleInput, supplier: string): boolean {
  const target = normalize(rule.matcher.value)
  if (!target) return false
  return rule.matcher.type === "exact" ? supplier === target : supplier.includes(target)
}

/** Exact beats contains regardless of recency; among rules of the same type, the older rule wins.
 * Older-wins (not newer-wins) is deliberate: a rule someone has been relying on longer should not
 * be silently shadowed by a newly added, more general one matching the same supplier text. */
function pickBest(matches: AutomationRuleInput[]): AutomationRuleInput {
  return [...matches].sort((a, b) => {
    if (a.matcher.type !== b.matcher.type) return a.matcher.type === "exact" ? -1 : 1
    return a.createdAt.getTime() - b.createdAt.getTime()
  })[0]
}

/** Runs every eligible rule against one document's extraction and returns what to do with it.
 *
 * Three independent reasons can send a document to review (WP10's ReviewTask):
 *   - "low_confidence": a rule matched, but the field it matched on was read at a confidence
 *     below the rule's own minConfidence — the coding is applied anyway (it's still the best
 *     guess), but a human should confirm the supplier was read correctly before it's trusted.
 *   - "rule_required": the matched rule is itself flagged requireReview — some suppliers' coding
 *     is judgment-dependent enough that automation should never apply it unattended.
 *   - "no_match_risky": nothing matched, but at least one active rule exists for this template —
 *     meaning this workspace has come to expect its suppliers to be recognised, and this one
 *     wasn't. A workspace with zero rules configured yet gets no reviewReason here; there is
 *     nothing "risky" about the default, rule-free state. */
export function applyRules(rules: AutomationRuleInput[], extraction: ExtractionForMatch): RuleApplicationResult {
  const eligible = rules.filter((rule) => isEligible(rule, extraction.templateCode))
  const supplier = normalize(extraction.supplierValue ?? "")
  const matches = supplier ? eligible.filter((rule) => isMatch(rule, supplier)) : []

  if (!matches.length) {
    return { ruleId: null, codingData: null, reviewReason: eligible.length ? "no_match_risky" : null }
  }

  const best = pickBest(matches)
  const lowConfidence = best.minConfidence !== null && extraction.supplierConfidence !== null && extraction.supplierConfidence < best.minConfidence
  const reviewReason: ReviewReason | null = lowConfidence ? "low_confidence" : best.requireReview ? "rule_required" : null

  return { ruleId: best.id, codingData: best.actions.codingData, reviewReason }
}
