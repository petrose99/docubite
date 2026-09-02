/** Flags a vendor that keeps showing up with no automation rule coding it: 3+ documents in the
 * last 30 days whose supplier matched no active AutomationRule. Reuses applyRules
 * (lib/automation/rules.ts) for the actual matching rather than reimplementing matcher logic, and
 * SUPPLIER_FIELD_BY_TEMPLATE (same module) to know which template has a "vendor" concept at all —
 * a document whose template has none is simply not eligible for this check. */
import { applyRules, SUPPLIER_FIELD_BY_TEMPLATE, type AutomationRuleInput } from "@/lib/automation/rules"
import type { CheckContext, CheckDefinition, CheckDocumentSlice, CheckRunResult } from "@/lib/health/types"

export const RULE_COVERAGE_MIN_UNMATCHED = 3

function normalizeSupplier(value: string): string {
  return value.trim().toLowerCase()
}

function inRange(document: CheckDocumentSlice, ctx: CheckContext): boolean {
  return document.receivedAt >= ctx.dateRange.from && document.receivedAt <= ctx.dateRange.to
}

function eligible(document: CheckDocumentSlice): boolean {
  return !!document.templateCode && !!SUPPLIER_FIELD_BY_TEMPLATE[document.templateCode] && !!document.supplierValue
}

export const ruleCoverageCheck: CheckDefinition = {
  code: "rule_coverage",
  name: "Rule coverage gaps",
  category: "pipeline",
  defaultWeight: 1,
  requiresLedger: false,
  run: (ctx): CheckRunResult => {
    const candidates = ctx.documents.filter((document) => inRange(document, ctx) && eligible(document))
    const applicableCount = candidates.length
    if (!applicableCount) return { findings: [], applicableCount }

    const unmatchedByVendor = new Map<string, CheckDocumentSlice[]>()
    for (const document of candidates) {
      const result = applyRules(ctx.automationRules as AutomationRuleInput[], {
        templateCode: document.templateCode as string,
        supplierValue: document.supplierValue,
        supplierConfidence: document.supplierConfidence,
      })
      if (result.ruleId) continue
      const key = normalizeSupplier(document.supplierValue as string)
      const group = unmatchedByVendor.get(key)
      if (group) group.push(document)
      else unmatchedByVendor.set(key, [document])
    }

    const findings = Array.from(unmatchedByVendor.values())
      .filter((group) => group.length >= RULE_COVERAGE_MIN_UNMATCHED)
      .map((group) => {
        const representative = [...group].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0]
        const vendor = representative.supplierValue as string
        return {
          checkCode: "rule_coverage",
          category: "pipeline" as const,
          severity: "info" as const,
          title: `"${vendor}" has no automation rule`,
          description: `${group.length} documents from "${vendor}" in the last 30 days matched no active rule.`,
          documentId: representative.id,
          suggestedAction: "create_rule",
          suggestedActionPayload: { supplier: vendor, documentIds: group.map((d) => d.id) },
          affectedCount: group.length,
        }
      })

    return { findings, applicableCount }
  },
}
