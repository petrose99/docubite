import { prisma } from "@/lib/db"
import { REVIEWED_OR_READY_STATUSES } from "@/lib/documents/stages"
import { REVIEW_TASK_STATUSES } from "@/models/review-tasks"

/** Read-only finance-inbox queries, shared by the finance agent's ai-chat tools
 * (app/api/ai-chat/route.ts) and any future server action that wants the same numbers — plain
 * functions rather than tool definitions, so neither caller has to go through the other (the same
 * split retrieval already has between lib/retrieval.ts and its ai-chat tool wrappers). Every
 * function here is a pure read: nothing mutates, so none of these need the pending-changes
 * confirm-before-acting flow the plan's "Act tools" (approve, code, push) do. */

/** Counts per review-task status, plus how many documents currently have a failing (not just
 * warning) check and how many have no automation rule applied at all — the two things a finance
 * user asks "what needs attention" actually means. */
export async function getInboxSummary(workspaceId: string) {
  const [statusCounts, failingChecks, unmatchedRecent] = await Promise.all([
    prisma.reviewTask.groupBy({ by: ["status"], where: { workspaceId }, _count: { _all: true } }),
    prisma.documentCheckResult.count({ where: { workspaceId, status: "fail" } }),
    prisma.document.count({ where: { workspaceId, appliedRuleId: null, status: { in: [...REVIEWED_OR_READY_STATUSES] } } }),
  ])
  const byStatus = Object.fromEntries(REVIEW_TASK_STATUSES.map((status) => [status, 0])) as Record<string, number>
  for (const row of statusCounts) byStatus[row.status] = row._count._all
  return { reviewTasksByStatus: byStatus, documentsWithFailingChecks: failingChecks, documentsWithNoRuleApplied: unmatchedRecent }
}

/** Documents whose vendor/merchant field contains the query, most recent first. Matches on
 * reviewedData first (the corrected value), falling back to rawExtraction — the same precedence
 * lib/document-export.ts and lib/integration-bill-mapping.ts use, so "find Acme's invoices"
 * doesn't miss one just because nobody has reviewed it yet. Filtered in application code rather
 * than a Postgres JSON query: the field key differs by template (vendor vs merchant) and the two
 * data columns need the same fallback, which is simpler to express once here than as SQL run
 * against a modest per-workspace row count. */
export async function findSupplierDocuments(workspaceId: string, supplierQuery: string, limit = 20) {
  const needle = supplierQuery.trim().toLowerCase()
  if (!needle) return []
  const candidates = await prisma.document.findMany({
    where: { workspaceId, template: { code: { in: ["invoice", "receipt", "expense_receipt"] } } },
    select: { id: true, filename: true, status: true, receivedAt: true, reviewedData: true, rawExtraction: true, template: { select: { code: true } } },
    orderBy: { receivedAt: "desc" },
    take: 300,
  })
  const matches = candidates.filter((doc) => {
    const data = (doc.reviewedData as Record<string, unknown> | null) ?? (doc.rawExtraction as Record<string, unknown> | null) ?? {}
    const supplier = String(data.vendor ?? data.merchant ?? "").toLowerCase()
    return supplier.includes(needle)
  }).slice(0, limit)
  return matches.map((doc) => {
    const data = (doc.reviewedData as Record<string, unknown> | null) ?? (doc.rawExtraction as Record<string, unknown> | null) ?? {}
    return {
      documentId: doc.id, filename: doc.filename, status: doc.status, receivedAt: doc.receivedAt.toISOString(),
      supplier: String(data.vendor ?? data.merchant ?? ""), total: data.total ?? null,
    }
  })
}

/** One document's fields, confidence, check results and workflow state — everything
 * "explain this document" needs in one call. */
export async function getDocumentDetails(workspaceId: string, documentId: string) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, workspaceId },
    select: {
      id: true, filename: true, status: true, reviewedData: true, rawExtraction: true, confidence: true, codingData: true,
      appliedRule: { select: { id: true, name: true } },
      checkResults: { select: { checkCode: true, status: true, message: true } },
      reviewTasks: { select: { id: true, status: true, reason: true, detail: true, workflowId: true, currentStageIndex: true }, orderBy: { createdAt: "desc" }, take: 5 },
    },
  })
  if (!document) return null
  return {
    documentId: document.id, filename: document.filename, status: document.status,
    fields: document.reviewedData ?? document.rawExtraction ?? {},
    confidence: document.confidence ?? {},
    coding: document.codingData ?? null,
    appliedRule: document.appliedRule,
    checks: document.checkResults,
    reviewTasks: document.reviewTasks,
  }
}

/** Submitted-or-later expense claims, most recent first — what the agent reads to find a claim id
 * before proposing decide_expense_claim (WP3.5); a draft is deliberately excluded here since
 * there's nothing for the agent to decide about one yet. */
export async function getExpenseClaims(workspaceId: string, limit = 20) {
  const claims = await prisma.expenseClaim.findMany({
    where: { workspaceId, status: { not: "draft" } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true, title: true, status: true, total: true, currencyCode: true, workflowId: true, currentStageIndex: true },
  })
  return claims.map((claim) => ({
    claimId: claim.id, title: claim.title, status: claim.status, total: claim.total, currencyCode: claim.currencyCode,
    hasWorkflow: Boolean(claim.workflowId && claim.currentStageIndex !== null),
  }))
}

/** Active supplier rules, most-used first — what the agent reads before proposing a new one, so
 * it doesn't suggest a rule that's a near-duplicate of one that already exists. */
export async function getSupplierRules(workspaceId: string) {
  const rules = await prisma.automationRule.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, name: true, matcher: true, actions: true, requireReview: true, autopublish: true, hitCount: true },
    orderBy: { hitCount: "desc" },
    take: 100,
  })
  return rules
}
