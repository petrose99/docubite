/** Phase A of the Data Health feature: a workspace-wide score built from checks over the document
 * pipeline. Mirrors lib/checks/ + lib/automation/rules.ts's convention exactly — every check is a
 * pure function over a plain-data context, no Prisma import, unit-testable without a database. The
 * database I/O that assembles CheckContext and persists findings lives in models/health.ts. */
import type { AutomationRuleInput } from "@/lib/automation/rules"
import type { MatchCandidateDocument } from "@/lib/bank-match/matcher"

export type HealthCategory = "cleanup" | "pipeline" | "tax" | "activity"
export type HealthSeverity = "critical" | "warning" | "info"

/** One AccountingEntity row (account | vendor | tax_rate) as the ledger checks need it — a plain
 * slice of the cached provider data, same idea as CheckDocumentSlice. */
export type LedgerAccountingEntitySlice = {
  id: string
  externalId: string
  entityType: "account" | "vendor" | "tax_rate"
  name: string
  active: boolean
}

/** One LedgerTransaction row (bill | expense | bank_transaction) synced from an
 * IntegrationConnection's provider by lib/health/sync.ts's syncLedgerTransactions. */
export type LedgerTransactionSlice = {
  id: string
  externalId: string
  kind: "bill" | "expense" | "bank_transaction"
  contactExternalId: string | null
  contactName: string | null
  accountExternalId: string | null
  accountName: string | null
  docNumber: string | null
  amount: number | null
  taxAmount: number | null
  currencyCode: string | null
  txnDate: Date | null
  reconciled: boolean
  active: boolean
}

/** Phase B: ledger transactions + the cached chart of accounts/vendors/tax rates for whichever
 * IntegrationConnection the workspace has active, plus DocuBite's own documents in the shape
 * lib/bank-match/matcher.ts's suggestMatches needs (for unreconciled_transactions) — assembled
 * once in models/health.ts, same as every other CheckContext slice. Phase A had no ledger
 * connection at all, so every Phase A check still declares `requiresLedger: false` and gets `null`
 * here whenever a workspace has no active connection; Phase B's cleanup checks declare
 * `requiresLedger: true` and are skipped by lib/health/registry.ts's runnableChecks whenever this
 * is null. */
export type LedgerContext = {
  transactions: LedgerTransactionSlice[]
  accountingEntities: LedgerAccountingEntitySlice[]
  matchCandidateDocuments: MatchCandidateDocument[]
}

export type CheckDocumentSlice = {
  id: string
  fileId: string
  filename: string
  templateCode: string | null
  status: string
  receivedAt: Date
  /** The vendor/merchant/supplier field's value, resolved per-template via
   * lib/automation/rules.ts's SUPPLIER_FIELD_BY_TEMPLATE — null when the template has no such
   * field or it wasn't read. */
  supplierValue: string | null
  supplierConfidence: number | null
  /** Whether this document has any IntegrationPush row at all (any status). */
  hasPush: boolean
  /** Whether this document has ever had a ReviewTask resolved as "rejected". */
  hasRejectedReviewTask: boolean
  /** Phase C: the LedgerTransaction.externalId this document was pushed to, when its most recent
   * IntegrationPush succeeded and recorded one — null for a document never pushed, still pending,
   * or whose push failed. Lets tax-mismatch.ts join a document back to the ledger row it produced
   * without a second query per document. Optional so every pre-Phase-C test fixture that builds a
   * CheckDocumentSlice literal by hand keeps compiling unchanged. */
  pushedExternalBillId?: string | null
  /** Phase C: this document's extracted tax total (the `tax_total` DocumentFieldValue for
   * whichever field key its template maps to), or null when the template has no such field or it
   * was never extracted. Optional for the same reason as pushedExternalBillId. */
  extractedTaxTotal?: number | null
  /** Phase C: true when this document's template normally carries a tax field AND the workspace
   * has a TaxProfile configured — i.e. a missing extractedTaxTotal here is actually worth flagging,
   * not just "this template has no concept of tax" or "this workspace hasn't set up tax at all".
   * Optional for the same reason as pushedExternalBillId. */
  taxExpected?: boolean
  /** Phase D: Document.reviewedAt — when a person resolved this document's review, null if it was
   * never reviewed (auto-published, still pending, or predates review tracking). Optional for the
   * same reason as pushedExternalBillId. */
  reviewedAt?: Date | null
  /** Phase D: true when Document.appliedRuleId is set — an AutomationRule coded this document,
   * the automation signal automation-rate.ts scores against. Optional for the same reason as
   * pushedExternalBillId. */
  hasAppliedRule?: boolean
}

export type CheckReviewTaskSlice = {
  id: string
  documentId: string
  status: "open" | "in_review" | "approved" | "rejected"
  createdAt: Date
}

export type CheckPushSlice = {
  id: string
  documentId: string
  status: string
  attempts: number
  errorCode: string | null
  updatedAt: Date
}

export type CheckResultSlice = {
  documentId: string
  checkCode: string
  status: "pass" | "warn" | "fail"
}

/** One template's rolling-30-day mean sourceConfidence versus the prior 30 days — the aggregate
 * `document_field_values` query result (lib/health/checks/confidence-drift.ts's buildConfidenceDriftSql),
 * computed once in models/health.ts and handed in rather than re-queried per check. */
export type ConfidenceDriftRow = {
  templateCode: string
  currentMean: number
  currentCount: number
  priorMean: number
  priorCount: number
  /** The most recently received document of this template in the current window — the finding's
   * representative link, since a template-level drift has no single document of its own. */
  representativeDocumentId: string | null
}

/** One low-confidence extracted field with no resolved/approved review covering its document —
 * the `document_field_values` × `review_tasks` join uncorrected-low-confidence.ts needs, computed
 * once in models/health.ts. */
export type LowConfidenceFieldSlice = {
  documentId: string
  fieldKey: string
  sourceConfidence: number
}

/** One `bank_statement`-template Document, pre-aggregated for bank-reconciliation.ts — computed
 * once in models/health.ts (transaction-row count off `reviewedData.transactions`, accepted-match
 * count off real BankMatch rows via lib/bank-match/matcher.ts's existing matching, never
 * recomputed by the check itself) so the check stays a pure function over plain counts, same as
 * every other CheckContext slice. */
export type BankStatementSlice = {
  documentId: string
  fileId: string
  filename: string
  receivedAt: Date
  transactionCount: number
  acceptedMatchCount: number
}

export type CheckContext = {
  workspaceId: string
  dateRange: { from: Date; to: Date }
  ledger: LedgerContext | null
  documents: CheckDocumentSlice[]
  reviewTasks: CheckReviewTaskSlice[]
  pushHistory: CheckPushSlice[]
  automationRules: AutomationRuleInput[]
  checkResults: CheckResultSlice[]
  confidenceDrift: ConfidenceDriftRow[]
  lowConfidenceFields: LowConfidenceFieldSlice[]
  bankStatements: BankStatementSlice[]
}

export type HealthFinding = {
  checkCode: string
  category: HealthCategory
  severity: HealthSeverity
  title: string
  description: string
  /** Links this finding to one source document, when it has one — most findings do; a handful
   * (review_backlog) are workspace-wide and have none. */
  documentId?: string | null
  /** Always null in Phase A — this app has no ledger transactions yet. Kept for later phases. */
  externalTransactionId?: string | null
  suggestedAction?: string | null
  suggestedActionPayload?: Record<string, unknown> | null
  /** How many underlying items (documents, pushes, rule-less documents...) this one finding
   * represents — a grouped finding ("5 failed pushes with errorCode X") is still one row, but the
   * UI needs the count to say so. */
  affectedCount: number
}

/** What one check produced this run: its findings, plus how many items it evaluated in total
 * (`applicableCount`) — the population size lib/health/score.ts needs to know a check had nothing
 * to say about ("zero applicable items") rather than treating an empty findings array as a clean
 * pass. A check with applicableCount 0 is skipped from the score entirely. */
export type CheckRunResult = {
  findings: HealthFinding[]
  applicableCount: number
}

export type CheckDefinition = {
  code: string
  name: string
  category: HealthCategory
  defaultWeight: number
  /** Every Phase A check is false — none of them read `ctx.ledger`. A later phase's checks that do
   * set this true, so the engine can skip them entirely while `ctx.ledger` is null. */
  requiresLedger: boolean
  /** Whether this check gets its own link in the Health page's left sub-nav
   * (components/health/health-sidebar-nav.tsx). Every check still runs and still counts toward the
   * score regardless of this flag — it only controls sidebar visibility. Default true (a check
   * omits this field to appear); set false for a check that's real and worth scoring but not worth
   * a standing nav entry — first used to cut the sidebar down to the handful of checks a person
   * can actually act on (bank reconciliation, review backlog, failed pushes, duplicate bills, rule
   * coverage, stale documents) after user feedback that a 21-item flat list read as clutter next to
   * those concrete ones. */
  showInNav?: boolean
  run: (ctx: CheckContext) => CheckRunResult
}
