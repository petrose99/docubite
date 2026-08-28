import { normalizeBillFromDocument, BillMappingError } from "@/lib/integration-bill-mapping"
import { attemptIntegrationPush, kickIntegrationPushDrain } from "@/lib/integration-push"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { prisma } from "@/lib/db"
import { upsertWorkspaceIntegrationPush } from "@/models/integrations"

/** The template codes accounting-push can push — kept in one place rather than duplicated between
 * this and integration-push-actions.ts's manual path would be tidier, but the two were built at
 * different times against slightly different sets (this one matches the module registry's
 * pushableTemplateCodes; the manual action's own set is narrower and is a known drift to reconcile
 * — see HANDOFF-INDUSTRY-WORKSPACES.md). */
const PUSHABLE_TEMPLATE_CODES = new Set(["invoice", "receipt", "expense_receipt"])

/** Pushes a document to its workspace's connected accounting provider automatically, when the rule
 * that coded it has autopublish=true. Called from two places: right after a rule applies to a
 * document with no review required (models/automation-rules.ts), and right after a reviewer
 * approves a review task for a rule-coded document (review-actions.ts) — the two moments the plan
 * calls "high-confidence, rule-coded, requireReview=false" and "a person just confirmed it".
 *
 * Never throws. Autopublish is a convenience layered on top of the always-available manual push
 * (integration-push-actions.ts); a failure here must not break rule application or review
 * approval, the same "must not break the thing it rides on" reasoning as applyAutomationRules'
 * own try/catch. */
export async function maybeAutopublish(workspaceId: string, documentId: string, actorId: string | null): Promise<void> {
  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, filename: true, reviewedData: true, rawExtraction: true, appliedRuleId: true, template: { select: { code: true } } },
    })
    if (!document?.appliedRuleId) return
    const templateCode = document.template?.code
    if (!templateCode || !PUSHABLE_TEMPLATE_CODES.has(templateCode)) return

    const rule = await prisma.automationRule.findFirst({ where: { id: document.appliedRuleId, workspaceId }, select: { autopublish: true } })
    if (!rule?.autopublish) return

    const caps = await getWorkspaceCapabilities(workspaceId)
    if (!caps.has("accounting-push")) return

    // The oldest active connection: a workspace with more than one connected provider has no rule
    // for which one autopublish should prefer, so this is a placeholder until that's a real
    // decision to make (multi-provider push isn't built yet either).
    const connection = await prisma.integrationConnection.findFirst({ where: { workspaceId, status: "active" }, orderBy: { createdAt: "asc" } })
    if (!connection) return

    // Never double-enqueue: a document already pushed (or mid-attempt) to this connection keeps
    // its existing row rather than getting a second one racing it.
    const existingPush = await prisma.integrationPush.findFirst({ where: { workspaceId, documentId, connectionId: connection.id }, select: { id: true } })
    if (existingPush) return

    const reviewedData = (document.reviewedData as Record<string, unknown> | null) ?? (document.rawExtraction as Record<string, unknown> | null) ?? {}
    const bill = normalizeBillFromDocument({ documentId: document.id, filename: document.filename, templateCode, reviewedData })
    const push = await upsertWorkspaceIntegrationPush(workspaceId, {
      connectionId: connection.id, documentId: document.id, provider: connection.provider as "quickbooks" | "xero", payload: bill, createdById: actorId,
    })
    await attemptIntegrationPush(push.id)
    const updated = await prisma.integrationPush.findUnique({ where: { id: push.id }, select: { status: true } })
    if (updated?.status === "pending") await kickIntegrationPushDrain()
  } catch (error) {
    if (error instanceof BillMappingError) return
    console.error("[automation] autopublish failed:", error instanceof Error ? error.message : error)
  }
}
