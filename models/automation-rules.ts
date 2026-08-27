// Deliberately NOT a "use server" module, matching models/documents.ts and models/review-tasks.ts:
// these helpers trust the workspaceId they are handed. Server actions live in
// app/(app)/workspaces/[workspaceId]/automation-actions.ts and do the auth.
import { track } from "@/lib/analytics"
import { applyRules, type AutomationRuleInput, type ExtractionForMatch, type RuleActions, type RuleMatcher } from "@/lib/automation/rules"
import { auditEventData, getRequestAuditContext } from "@/lib/audit"
import { prisma } from "@/lib/db"
import { createReviewTask } from "@/models/review-tasks"
import { Prisma } from "@/prisma/client"
import { cache } from "react"

export const listAutomationRules = cache(async (workspaceId: string) => prisma.automationRule.findMany({
  where: { workspaceId },
  orderBy: [{ isActive: "desc" }, { hitCount: "desc" }, { createdAt: "asc" }],
}))

export async function createAutomationRule(input: { workspaceId: string; name: string; matcher: RuleMatcher; actions: RuleActions; minConfidence?: number | null; requireReview?: boolean; createdById: string | null }) {
  if (!input.matcher.value.trim()) throw new Error("matcher_value_required")
  return prisma.automationRule.create({
    data: {
      workspaceId: input.workspaceId, name: input.name.trim() || "Untitled rule",
      matcher: input.matcher as unknown as Prisma.InputJsonValue, actions: input.actions as unknown as Prisma.InputJsonValue,
      minConfidence: input.minConfidence ?? null, requireReview: input.requireReview ?? false, createdById: input.createdById,
    },
  })
}

/** The "update rule" correction flow: a reviewer fixing a rule-applied field edits the rule
 * itself, which only ever changes what FUTURE documents get — this never touches a document
 * already coded by the old version, and never rewrites the rule.applied audit event that recorded
 * what actually happened at the time. */
export async function updateAutomationRule(input: { workspaceId: string; ruleId: string; actorId: string; name?: string; matcher?: RuleMatcher; actions?: RuleActions; minConfidence?: number | null; requireReview?: boolean; isActive?: boolean }) {
  const rule = await prisma.automationRule.findFirst({ where: { id: input.ruleId, workspaceId: input.workspaceId }, select: { id: true } })
  if (!rule) throw new Error("automation_rule_not_found")
  const context = await getRequestAuditContext()
  const [updated] = await prisma.$transaction([
    prisma.automationRule.update({
      where: { id: rule.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() || "Untitled rule" } : {}),
        ...(input.matcher !== undefined ? { matcher: input.matcher as unknown as Prisma.InputJsonValue } : {}),
        ...(input.actions !== undefined ? { actions: input.actions as unknown as Prisma.InputJsonValue } : {}),
        ...(input.minConfidence !== undefined ? { minConfidence: input.minConfidence } : {}),
        ...(input.requireReview !== undefined ? { requireReview: input.requireReview } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    }),
    prisma.documentAuditEvent.create({ data: auditEventData({ workspaceId: input.workspaceId, actorId: input.actorId, type: "rule.updated", detail: { ruleId: rule.id } }, context) }),
  ])
  // Only a real correction — the matcher or the coding itself changing — counts for this metric.
  // Flipping isActive, or editing the name, is bookkeeping, not "this rule was wrong".
  if (input.matcher !== undefined || input.actions !== undefined) {
    await track("automation_rule_corrected", { ruleId: input.ruleId }, { workspaceId: input.workspaceId, actorId: input.actorId })
  }
  return updated
}

/** Runs the pure engine against one document's already-committed extraction and persists whatever
 * it decides: coding data + which rule applied (or neither, on no match), a hit-count bump for the
 * rule that matched, a rule.applied audit event, and — for any of the engine's three review
 * reasons — a ReviewTask so the document surfaces in the queue (WP10) instead of silently landing
 * with unconfirmed coding. Called from the worker right after extraction commits
 * (lib/document-processing.ts); never throws past the caller, the same "must not break extraction
 * over a coding step" reasoning as every other post-extraction side effect there. */
export async function applyAutomationRules(input: { workspaceId: string; documentId: string; templateCode: string; extraction: ExtractionForMatch }): Promise<void> {
  try {
    const rows = await prisma.automationRule.findMany({ where: { workspaceId: input.workspaceId, isActive: true } })
    const rules: AutomationRuleInput[] = rows.map((row) => ({
      id: row.id, matcher: row.matcher as unknown as RuleMatcher, actions: row.actions as unknown as RuleActions,
      minConfidence: row.minConfidence, requireReview: row.requireReview, isActive: row.isActive, createdAt: row.createdAt,
    }))
    const result = applyRules(rules, input.extraction)
    const context = await getRequestAuditContext()

    if (result.ruleId) {
      await prisma.$transaction([
        prisma.document.update({ where: { id: input.documentId }, data: { codingData: result.codingData as unknown as Prisma.InputJsonValue, appliedRuleId: result.ruleId } }),
        prisma.automationRule.update({ where: { id: result.ruleId }, data: { hitCount: { increment: 1 } } }),
        prisma.documentAuditEvent.create({ data: auditEventData({ workspaceId: input.workspaceId, documentId: input.documentId, type: "rule.applied", detail: { ruleId: result.ruleId, codingData: result.codingData } }, context) }),
      ])
    }

    if (result.reviewReason) {
      const detail = result.reviewReason === "no_match_risky"
        ? "No automation rule matched this document's supplier — coding was not applied."
        : result.reviewReason === "low_confidence"
          ? "The matched rule's supplier field was read at low confidence."
          : "The matched rule requires manual review."
      await createReviewTask({ workspaceId: input.workspaceId, documentId: input.documentId, reason: "rule_required", detail, createdById: null })
    }
  } catch (error) {
    console.error("[automation] failed to apply rules:", error instanceof Error ? error.message : error)
  }
}
