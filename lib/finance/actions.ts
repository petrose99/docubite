import { prisma } from "@/lib/db"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { listAccountingEntities } from "@/models/accounting-entities"

/** Validates and describes the finance agent's proposed write actions — never performs one.
 *
 * Every function here answers "is this proposal real, and what does it actually mean" (does the
 * task/document exist in this workspace, is a push connection actually available) so the ai-chat
 * tool that calls it can hand the model a grounded summary — but the actual mutation only happens
 * when a person accepts the proposal in the assistant panel, via the same server actions the
 * manual UI already uses (bulkUpdateReviewTaskStatusAction, updateReviewTaskStatusAction,
 * setDocumentCodingAction, createAutomationRuleAction, pushDocumentToAccountingAction). That split
 * — propose here, execute only on accept — is what "agent proposes, human confirms" (Part 5c)
 * means for actions with a real external or financial side effect, as opposed to the sheet
 * assistant's write-then-optionally-undo cell tools: a bill already pushed to QuickBooks has no
 * clean undo, so confirmation has to come BEFORE the push, not after. */

export type FinanceProposal =
  | { kind: "approve_review_tasks"; taskIds: string[]; summary: string }
  | { kind: "reject_review_task"; taskId: string; summary: string }
  | { kind: "set_document_coding"; documentId: string; codingData: Record<string, string | number>; summary: string }
  | { kind: "create_supplier_rule"; name: string; matcherType: "exact" | "contains"; matcherValue: string; account: string; requireReview: boolean; autopublish: boolean; summary: string }
  | { kind: "push_to_accounting"; documentId: string; connectionId: string; summary: string }

export type FinanceProposalResult = FinanceProposal | { error: string }

export async function describeApproveReviewTasks(workspaceId: string, taskIds: string[]): Promise<FinanceProposalResult> {
  if (!(await getWorkspaceCapabilities(workspaceId)).has("review-queue")) return { error: "review_queue_not_enabled" }
  const tasks = await prisma.reviewTask.findMany({ where: { id: { in: taskIds.slice(0, 50) }, workspaceId }, select: { id: true, document: { select: { filename: true } } } })
  if (!tasks.length) return { error: "no_matching_review_tasks" }
  const names = tasks.map((task) => task.document.filename)
  const summary = tasks.length === 1
    ? `Approve the review task for "${names[0]}"`
    : `Approve ${tasks.length} review tasks: ${names.slice(0, 5).join(", ")}${names.length > 5 ? `, +${names.length - 5} more` : ""}`
  return { kind: "approve_review_tasks", taskIds: tasks.map((task) => task.id), summary }
}

export async function describeRejectReviewTask(workspaceId: string, taskId: string): Promise<FinanceProposalResult> {
  if (!(await getWorkspaceCapabilities(workspaceId)).has("review-queue")) return { error: "review_queue_not_enabled" }
  const task = await prisma.reviewTask.findFirst({ where: { id: taskId, workspaceId }, select: { id: true, document: { select: { filename: true } } } })
  if (!task) return { error: "review_task_not_found" }
  return { kind: "reject_review_task", taskId: task.id, summary: `Reject the review task for "${task.document.filename}"` }
}

export async function describeSetDocumentCoding(workspaceId: string, documentId: string, codingData: Record<string, string | number>): Promise<FinanceProposalResult> {
  if (!(await getWorkspaceCapabilities(workspaceId)).has("review-queue")) return { error: "review_queue_not_enabled" }
  if (!Object.keys(codingData).length) return { error: "coding_data_required" }
  const document = await prisma.document.findFirst({ where: { id: documentId, workspaceId }, select: { filename: true } })
  if (!document) return { error: "document_not_found" }
  const coding = Object.entries(codingData).map(([key, value]) => `${key}: ${value}`).join(", ")
  return { kind: "set_document_coding", documentId, codingData, summary: `Code "${document.filename}" as ${coding}` }
}

/** Normalizes an account string for fuzzy comparison: lowercase, trimmed, punctuation collapsed
 * to spaces — "6000 - Printing" and "6000 Printing" should compare equal. */
function normalizeAccountText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

/** Snaps a freehand account string onto this workspace's synced chart of accounts (WP1.5), when
 * one exists and a confident match is found — an exact normalized match, or the freehand text
 * appearing wholly inside exactly one synced account's code+name (never the reverse: a short
 * freehand string like "6000" matching many accounts is not confident). Returns the original
 * string unchanged when there is nothing to snap to, so a workspace with no connection (or the
 * agent describing a brand-new account) is unaffected. */
export function snapAccountToSyncedList(account: string, syncedAccounts: { code: string | null; name: string }[]): string {
  if (!syncedAccounts.length) return account
  const needle = normalizeAccountText(account)
  if (!needle) return account
  const labelFor = (entity: { code: string | null; name: string }) => entity.code ? `${entity.code} — ${entity.name}` : entity.name

  const exact = syncedAccounts.find((entity) => normalizeAccountText(labelFor(entity)) === needle || normalizeAccountText(entity.name) === needle || (entity.code && normalizeAccountText(entity.code) === needle))
  if (exact) return labelFor(exact)

  const containing = syncedAccounts.filter((entity) => normalizeAccountText(labelFor(entity)).includes(needle))
  return containing.length === 1 ? labelFor(containing[0]) : account
}

export async function describeCreateSupplierRule(workspaceId: string, input: { name?: string; matcherType: "exact" | "contains"; matcherValue: string; account: string; requireReview?: boolean; autopublish?: boolean }): Promise<FinanceProposalResult> {
  if (!(await getWorkspaceCapabilities(workspaceId)).has("supplier-rules")) return { error: "supplier_rules_not_enabled" }
  const matcherValue = input.matcherValue.trim()
  const rawAccount = input.account.trim()
  if (!matcherValue) return { error: "matcher_value_required" }
  if (!rawAccount) return { error: "account_required" }
  const syncedAccounts = await listAccountingEntities(workspaceId, "account")
  const account = snapAccountToSyncedList(rawAccount, syncedAccounts)
  const match = input.matcherType === "contains" ? `contains "${matcherValue}"` : `is exactly "${matcherValue}"`
  const parts = [`Create a rule: when the supplier ${match}, code it to ${account}`]
  if (input.requireReview) parts.push("always send it to review")
  if (input.autopublish) parts.push("and push it to accounting automatically")
  return {
    kind: "create_supplier_rule", name: input.name?.trim() || matcherValue, matcherType: input.matcherType, matcherValue, account,
    requireReview: Boolean(input.requireReview), autopublish: Boolean(input.autopublish),
    summary: parts.join(", "),
  }
}

export async function describePushToAccounting(workspaceId: string, documentId: string): Promise<FinanceProposalResult> {
  const capabilities = await getWorkspaceCapabilities(workspaceId)
  if (!capabilities.has("accounting-push")) return { error: "accounting_push_not_enabled" }
  const document = await prisma.document.findFirst({
    where: { id: documentId, workspaceId },
    select: { filename: true, status: true, template: { select: { code: true } } },
  })
  if (!document) return { error: "document_not_found" }
  if (document.status !== "reviewed") return { error: "document_not_reviewed" }
  if (!document.template?.code || !capabilities.pushableTemplateCodes.includes(document.template.code)) return { error: "document_type_not_pushable" }
  const connection = await prisma.integrationConnection.findFirst({ where: { workspaceId, status: "active" }, orderBy: { createdAt: "asc" }, select: { id: true, provider: true } })
  if (!connection) return { error: "no_active_connection" }
  return { kind: "push_to_accounting", documentId, connectionId: connection.id, summary: `Push "${document.filename}" to ${connection.provider === "quickbooks" ? "QuickBooks" : "Xero"}` }
}
