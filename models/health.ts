// Deliberately NOT a "use server" module, matching every other models/*.ts helper: trusts the
// workspaceId it is handed. Server actions live in
// app/(app)/workspaces/[workspaceId]/health-actions.ts and do the auth + capability gate.
import { SUPPLIER_FIELD_BY_TEMPLATE, type AutomationRuleInput } from "@/lib/automation/rules"
import type { MatchCandidateDocument } from "@/lib/bank-match/matcher"
import { buildConfidenceDriftSql } from "@/lib/health/checks/confidence-drift"
import { REGISTRY, runnableChecks } from "@/lib/health/registry"
import { computeHealthScore, projectHealthScore, type CheckScoreInput, type HealthScoreConfigInput, type HealthScoreResult, type ProjectedScoreResult } from "@/lib/health/score"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import type { BankStatementSlice, CheckContext, CheckDocumentSlice, CheckPushSlice, CheckResultSlice, CheckReviewTaskSlice, ConfidenceDriftRow, HealthFinding, LedgerAccountingEntitySlice, LedgerContext, LedgerTransactionSlice, LowConfidenceFieldSlice } from "@/lib/health/types"
import { prisma } from "@/lib/db"
import { getTaxProfile } from "@/models/tax-profiles"
import { Prisma } from "@/prisma/client"
import { cache } from "react"

const CANDIDATE_CAP = 500
const LOW_CONFIDENCE_THRESHOLD = 0.7

// Same per-template field map lib/bank-match's models/bank-matches.ts uses to read a document's
// amount/date/currency out of its reviewedData — duplicated here (not imported, that file doesn't
// export it) since this call site's population differs (every eligible document in the workspace,
// not "every document except the one being matched").
const CANDIDATE_FIELD_MAPS: Record<string, { supplier: string; total: string; date: string; currency: string; invoiceNumber?: string }> = {
  invoice: { supplier: "vendor", total: "total", date: "issue_date", currency: "currency_code", invoiceNumber: "invoice_number" },
  receipt: { supplier: "merchant", total: "total", date: "purchase_date", currency: "currency_code", invoiceNumber: "receipt_number" },
  expense_receipt: { supplier: "merchant", total: "total", date: "purchase_date", currency: "currency_code", invoiceNumber: "receipt_number" },
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}
function asDate(value: unknown): Date | null {
  if (typeof value !== "string") return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function fingerprintFor(checkCode: string, documentId: string | null | undefined, externalTransactionId: string | null | undefined): string {
  return `${checkCode}:${documentId ?? ""}:${externalTransactionId ?? ""}`
}

// ---- Context assembly -----------------------------------------------------------------------

// Phase C: which reviewedData key each finance template uses for its tax total — same
// per-template field-name problem CANDIDATE_FIELD_MAPS above and models/document-checks.ts's
// CHECK_FIELD_MAPS both solve, narrowed to just the one field tax-mismatch.ts/missing-tax.ts need.
// Not imported from document-checks.ts: that module doesn't export its map, and this call site's
// need (one field, across every eligible document) doesn't warrant widening that module's surface.
const TAX_FIELD_BY_TEMPLATE: Record<string, string> = {
  invoice: "tax_total",
  receipt: "tax_total",
  expense_receipt: "tax_total",
}

async function loadDocuments(workspaceId: string, taxExpectedByDefault: boolean): Promise<CheckDocumentSlice[]> {
  const documents = await prisma.document.findMany({
    where: { workspaceId, status: { notIn: ["received", "queued", "processing"] } },
    select: {
      id: true, fileId: true, filename: true, receivedAt: true, reviewedData: true, reviewedAt: true, appliedRuleId: true,
      template: { select: { code: true } },
      integrationPushes: { select: { id: true, status: true, externalBillId: true }, take: 1, orderBy: { updatedAt: "desc" } },
      reviewTasks: { select: { id: true }, where: { status: "rejected" }, take: 1 },
    },
    orderBy: { receivedAt: "desc" },
    take: CANDIDATE_CAP,
  })

  return documents.map((document) => {
    const templateCode = document.template?.code ?? null
    const supplierField = templateCode ? SUPPLIER_FIELD_BY_TEMPLATE[templateCode] : undefined
    const values = (document.reviewedData ?? {}) as Record<string, unknown>
    const supplierValue = supplierField && typeof values[supplierField] === "string" ? (values[supplierField] as string).trim() || null : null
    const taxField = templateCode ? TAX_FIELD_BY_TEMPLATE[templateCode] : undefined
    const succeededPush = document.integrationPushes.find((push) => push.status === "succeeded" && push.externalBillId)
    return {
      id: document.id, fileId: document.fileId, filename: document.filename, templateCode,
      status: "extracted", receivedAt: document.receivedAt,
      supplierValue, supplierConfidence: null,
      hasPush: document.integrationPushes.length > 0,
      hasRejectedReviewTask: document.reviewTasks.length > 0,
      pushedExternalBillId: succeededPush?.externalBillId ?? null,
      extractedTaxTotal: taxField ? asNumber(values[taxField]) : null,
      taxExpected: Boolean(taxField) && taxExpectedByDefault,
      reviewedAt: document.reviewedAt,
      hasAppliedRule: document.appliedRuleId !== null,
    }
  })
}

/** Phase C: DocumentCheckResult rows for the two checks tax-consistency.ts/vat-number-format.ts
 * elevate into health findings — every non-"pass" row for those two codes, capped the same way
 * every other loader here is. tax_consistency/vat_number_format's actual logic lives in
 * lib/checks/tax-consistency.ts and lib/checks/vat-number.ts (computed once per document by
 * models/document-checks.ts's runDeterministicChecks); this reads their already-computed verdicts
 * rather than recomputing anything. */
async function loadCheckResults(workspaceId: string): Promise<CheckResultSlice[]> {
  const rows = await prisma.documentCheckResult.findMany({
    where: { workspaceId, checkCode: { in: ["tax_consistency", "vat_number_format"] }, status: { not: "pass" } },
    select: { documentId: true, checkCode: true, status: true },
    take: CANDIDATE_CAP,
  })
  return rows.map((row) => ({ documentId: row.documentId, checkCode: row.checkCode, status: row.status as CheckResultSlice["status"] }))
}

async function loadReviewTasks(workspaceId: string): Promise<CheckReviewTaskSlice[]> {
  const tasks = await prisma.reviewTask.findMany({
    where: { workspaceId, status: { in: ["open", "in_review"] } },
    select: { id: true, documentId: true, status: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: CANDIDATE_CAP,
  })
  return tasks.map((task) => ({ id: task.id, documentId: task.documentId, status: task.status as CheckReviewTaskSlice["status"], createdAt: task.createdAt }))
}

async function loadPushHistory(workspaceId: string): Promise<CheckPushSlice[]> {
  const pushes = await prisma.integrationPush.findMany({
    where: { workspaceId },
    select: { id: true, documentId: true, status: true, attempts: true, errorCode: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: CANDIDATE_CAP,
  })
  return pushes.map((push) => ({ id: push.id, documentId: push.documentId, status: push.status, attempts: push.attempts, errorCode: push.errorCode, updatedAt: push.updatedAt }))
}

async function loadAutomationRules(workspaceId: string): Promise<AutomationRuleInput[]> {
  const rules = await prisma.automationRule.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, matcher: true, actions: true, minConfidence: true, requireReview: true, isActive: true, createdAt: true },
    take: CANDIDATE_CAP,
  })
  return rules.map((rule) => ({
    id: rule.id,
    matcher: rule.matcher as AutomationRuleInput["matcher"],
    actions: rule.actions as AutomationRuleInput["actions"],
    minConfidence: rule.minConfidence,
    requireReview: rule.requireReview,
    isActive: rule.isActive,
    createdAt: rule.createdAt,
  }))
}

type ConfidenceDriftSqlRow = { templateCode: string; currentMean: string | number; currentCount: number; priorMean: string | number | null; priorCount: number; representativeDocumentId: string | null }

async function loadConfidenceDrift(workspaceId: string, to: Date): Promise<ConfidenceDriftRow[]> {
  const sql = buildConfidenceDriftSql(workspaceId, to)
  const rows = await prisma.$queryRawUnsafe<ConfidenceDriftSqlRow[]>(sql.text, ...sql.params)
  return rows.map((row) => ({
    templateCode: row.templateCode,
    currentMean: Number(row.currentMean),
    currentCount: Number(row.currentCount),
    priorMean: row.priorMean == null ? 0 : Number(row.priorMean),
    priorCount: Number(row.priorCount),
    representativeDocumentId: row.representativeDocumentId,
  }))
}

/** DocumentFieldValue rows below LOW_CONFIDENCE_THRESHOLD with no resolved/approved ReviewTask
 * covering their document. Raw SQL for the same reason as models/document-field-values.ts and
 * lib/analytics/workspace-analytics.ts: this is a join two levels removed from anything Prisma's
 * query builder expresses cleanly (NOT EXISTS against a second table, scoped by workspace on
 * every alias). */
async function loadLowConfidenceFields(workspaceId: string): Promise<LowConfidenceFieldSlice[]> {
  const rows = await prisma.$queryRawUnsafe<{ documentId: string; fieldKey: string; sourceConfidence: number }[]>(
    `SELECT dfv."document_id" AS "documentId", dfv."field_key" AS "fieldKey", dfv."source_confidence" AS "sourceConfidence"
     FROM "document_field_values" dfv
     WHERE dfv."workspace_id" = $1::uuid
       AND dfv."source_confidence" IS NOT NULL
       AND dfv."source_confidence" < $2
       AND dfv."item_key" IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM "review_tasks" rt
         WHERE rt."workspace_id" = $1::uuid AND rt."document_id" = dfv."document_id" AND rt."status" = 'approved'
       )
     ORDER BY dfv."created_at" DESC
     LIMIT $3`,
    workspaceId, LOW_CONFIDENCE_THRESHOLD, CANDIDATE_CAP,
  )
  return rows.map((row) => ({ documentId: row.documentId, fieldKey: row.fieldKey, sourceConfidence: Number(row.sourceConfidence) }))
}

/** Phase B: the workspace's ledger data for the cleanup checks — null when there is no active
 * accounting connection at all, in which case those checks are skipped entirely (see
 * lib/health/registry.ts's runnableChecks). Picks the first active connection when a workspace
 * somehow has more than one (IntegrationConnection is unique on (workspaceId, provider), so this
 * can only happen across providers, not within one) — same "there's realistically only ever one"
 * assumption app/(app)/workspaces/[workspaceId]/integration-connection-actions.ts already makes
 * for the default-account picker. */
async function loadLedgerContext(workspaceId: string): Promise<LedgerContext | null> {
  const connection = await prisma.integrationConnection.findFirst({
    where: { workspaceId, status: "active" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  })
  if (!connection) return null

  const [entities, transactions, matchCandidateDocuments] = await Promise.all([
    prisma.accountingEntity.findMany({
      where: { workspaceId, connectionId: connection.id },
      select: { id: true, externalId: true, entityType: true, name: true, active: true },
      take: CANDIDATE_CAP,
    }),
    prisma.ledgerTransaction.findMany({
      where: { workspaceId, connectionId: connection.id, active: true },
      select: {
        id: true, externalId: true, kind: true, contactExternalId: true, contactName: true,
        accountExternalId: true, accountName: true, docNumber: true, amount: true, taxAmount: true,
        currencyCode: true, txnDate: true, reconciled: true, active: true,
      },
      take: CANDIDATE_CAP,
    }),
    loadCandidateDocuments(workspaceId),
  ])

  const accountingEntities: LedgerAccountingEntitySlice[] = entities.map((e) => ({
    id: e.id, externalId: e.externalId, entityType: e.entityType as LedgerAccountingEntitySlice["entityType"],
    name: e.name, active: e.active,
  }))
  const transactionSlices: LedgerTransactionSlice[] = transactions.map((t) => ({
    id: t.id, externalId: t.externalId, kind: t.kind as LedgerTransactionSlice["kind"],
    contactExternalId: t.contactExternalId, contactName: t.contactName,
    accountExternalId: t.accountExternalId, accountName: t.accountName, docNumber: t.docNumber,
    amount: t.amount, taxAmount: t.taxAmount, currencyCode: t.currencyCode, txnDate: t.txnDate,
    reconciled: t.reconciled, active: t.active,
  }))

  return { transactions: transactionSlices, accountingEntities, matchCandidateDocuments }
}

/** DocuBite's own documents in the shape lib/bank-match/matcher.ts's suggestMatches needs, for
 * unreconciled_transactions.ts — same template/field mapping models/bank-matches.ts's
 * loadCandidateDocuments uses, but over every eligible document in the workspace rather than
 * "every document except the one being matched" (there is no single statement document driving
 * this comparison the way there is for a bank-match run). */
async function loadCandidateDocuments(workspaceId: string): Promise<MatchCandidateDocument[]> {
  const templateCodes = Object.keys(CANDIDATE_FIELD_MAPS)
  const documents = await prisma.document.findMany({
    where: { workspaceId, status: { notIn: ["received", "queued", "processing"] }, template: { code: { in: templateCodes } } },
    select: { id: true, reviewedData: true, template: { select: { code: true } } },
    take: CANDIDATE_CAP,
  })
  return documents.flatMap((document) => {
    const map = document.template ? CANDIDATE_FIELD_MAPS[document.template.code] : undefined
    if (!map) return []
    const values = (document.reviewedData ?? {}) as Record<string, unknown>
    return [{
      documentId: document.id,
      supplier: asString(values[map.supplier]),
      total: asNumber(values[map.total]),
      date: asDate(values[map.date]),
      currencyCode: asString(values[map.currency]),
      invoiceNumber: map.invoiceNumber ? asString(values[map.invoiceNumber]) : null,
    }]
  })
}

/** Accepted BankMatch count per statement document, for exactly the "bank" kind (not
 * "supplier_statement" — that's a separate reconciliation flow with its own matcher, see
 * lib/reconciliation/supplier-statement.ts, and bank_reconciliation.ts only cares about bank
 * statement documents). Shared by loadBankStatements and getBankReconciliationSummary so the two
 * call sites (CheckContext assembly vs. the dedicated dashboard) don't diverge on how "matched"
 * is defined. */
async function loadAcceptedBankMatchCounts(workspaceId: string, statementDocumentIds: string[]): Promise<Map<string, number>> {
  if (!statementDocumentIds.length) return new Map()
  const grouped = await prisma.bankMatch.groupBy({
    by: ["statementDocumentId"],
    where: { workspaceId, kind: "bank", status: "accepted", statementDocumentId: { in: statementDocumentIds } },
    _count: { _all: true },
  })
  return new Map(grouped.map((row) => [row.statementDocumentId, row._count._all]))
}

/** Every `bank_statement`-template document in the workspace, pre-aggregated for
 * bank-reconciliation.ts — see BankStatementSlice's own comment for why this aggregation happens
 * here rather than in the check itself. */
async function loadBankStatements(workspaceId: string): Promise<BankStatementSlice[]> {
  const documents = await prisma.document.findMany({
    where: { workspaceId, status: { notIn: ["received", "queued", "processing"] }, template: { code: "bank_statement" } },
    select: { id: true, fileId: true, filename: true, receivedAt: true, reviewedData: true },
    orderBy: { receivedAt: "desc" },
    take: CANDIDATE_CAP,
  })
  const acceptedCounts = await loadAcceptedBankMatchCounts(workspaceId, documents.map((d) => d.id))
  return documents.map((document) => {
    const values = (document.reviewedData ?? {}) as Record<string, unknown>
    const transactions = Array.isArray(values.transactions) ? (values.transactions as unknown[]) : []
    return {
      documentId: document.id, fileId: document.fileId, filename: document.filename, receivedAt: document.receivedAt,
      transactionCount: transactions.length,
      acceptedMatchCount: acceptedCounts.get(document.id) ?? 0,
    }
  })
}

async function buildCheckContext(workspaceId: string, now: Date): Promise<CheckContext> {
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  // Whether this workspace even has a tax region configured at all — a workspace with no
  // TaxProfile has no expectation of tax on anything, so missing-tax.ts must not flag every
  // untaxed document in a workspace that never set tax up in the first place.
  const taxProfile = await getTaxProfile(workspaceId)
  const [documents, reviewTasks, pushHistory, automationRules, confidenceDrift, lowConfidenceFields, checkResults, ledger, bankStatements] = await Promise.all([
    loadDocuments(workspaceId, taxProfile !== null),
    loadReviewTasks(workspaceId),
    loadPushHistory(workspaceId),
    loadAutomationRules(workspaceId),
    loadConfidenceDrift(workspaceId, now),
    loadLowConfidenceFields(workspaceId),
    loadCheckResults(workspaceId),
    loadLedgerContext(workspaceId),
    loadBankStatements(workspaceId),
  ])
  return {
    workspaceId, dateRange: { from, to: now }, ledger,
    documents, reviewTasks, pushHistory, automationRules, checkResults,
    confidenceDrift, lowConfidenceFields, bankStatements,
  }
}

// ---- Run + persist ----------------------------------------------------------------------------

/** Runs every check whose requiresLedger is false (every Phase A check) against a freshly
 * assembled CheckContext, upserts each produced finding by (workspaceId, fingerprint), and
 * auto-resolves any previously "open" row belonging to a check that ran this pass but did NOT
 * reproduce its fingerprint this time. Never resurrects a "dismissed" row. Never throws past the
 * caller — mirrors runDeterministicChecks' (models/document-checks.ts) error-handling style. */
export async function runHealthChecks(workspaceId: string): Promise<void> {
  try {
    const now = new Date()
    const ctx = await buildCheckContext(workspaceId, now)
    const checks = runnableChecks(ctx.ledger !== null)

    const seenFingerprints = new Set<string>()

    for (const check of checks) {
      const result = check.run(ctx)
      for (const finding of result.findings) {
        const fingerprint = fingerprintFor(finding.checkCode, finding.documentId, finding.externalTransactionId)
        seenFingerprints.add(fingerprint)
        await persistFinding(workspaceId, fingerprint, finding)
      }
    }

    // Auto-resolve: any row still "open" for a check code that ran this pass, but whose
    // fingerprint was not reproduced, is stale — the underlying condition cleared. A "dismissed"
    // row is left untouched either way; it is not resurrected just because the check ran again.
    const checkCodes = checks.map((check) => check.code)
    const stillOpen = await prisma.healthCheckResult.findMany({
      where: { workspaceId, status: "open", checkCode: { in: checkCodes } },
      select: { id: true, fingerprint: true },
    })
    const toResolve = stillOpen.filter((row) => !seenFingerprints.has(row.fingerprint)).map((row) => row.id)
    if (toResolve.length) {
      await prisma.healthCheckResult.updateMany({
        where: { id: { in: toResolve } },
        data: { status: "resolved", resolvedAt: now, resolvedAction: "auto_cleared" },
      })
    }
  } catch (error) {
    console.error("[health] failed to run health checks:", error instanceof Error ? error.message : error)
  }
}

async function persistFinding(workspaceId: string, fingerprint: string, finding: HealthFinding): Promise<void> {
  const data = {
    workspaceId, checkCode: finding.checkCode, category: finding.category, severity: finding.severity,
    title: finding.title, description: finding.description, fingerprint,
    documentId: finding.documentId ?? null, externalTransactionId: finding.externalTransactionId ?? null,
    suggestedAction: finding.suggestedAction ?? null,
    suggestedActionPayload: (finding.suggestedActionPayload ?? Prisma.JsonNull) as Prisma.InputJsonValue,
  }
  // Upserting on the (workspaceId, fingerprint) unique key updates the row in place on a
  // reprocess — including resurrecting a "resolved" row back to "open" if the condition
  // recurred, which is correct (only "dismissed" must survive a recurrence untouched). A
  // dismissed row that would otherwise match this fingerprint keeps its dismissed status: the
  // update clause only ever writes status "open" here, but a currently-dismissed row's whole
  // point is that a person decided not to see it again — so it is left alone unless it's not
  // dismissed.
  const existing = await prisma.healthCheckResult.findUnique({ where: { workspaceId_fingerprint: { workspaceId, fingerprint } }, select: { status: true } })
  if (existing?.status === "dismissed") return

  await prisma.healthCheckResult.upsert({
    where: { workspaceId_fingerprint: { workspaceId, fingerprint } },
    create: { ...data, status: "open" },
    update: { ...data, status: "open", resolvedAt: null, resolvedById: null, resolvedAction: null },
  })
}

// ---- Reads + manual actions --------------------------------------------------------------------

export type HealthFindingFilters = { status?: "open" | "dismissed" | "resolved"; category?: string; checkCode?: string }

export const listHealthFindings = cache(async (workspaceId: string, filters: HealthFindingFilters = {}) => prisma.healthCheckResult.findMany({
  where: {
    workspaceId,
    status: filters.status ?? "open",
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.checkCode ? { checkCode: filters.checkCode } : {}),
  },
  include: { document: { select: { id: true, filename: true, fileId: true } } },
  orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
  take: CANDIDATE_CAP,
}))

export async function dismissHealthFinding(input: { workspaceId: string; findingId: string; actorId: string }) {
  const finding = await prisma.healthCheckResult.findFirst({ where: { id: input.findingId, workspaceId: input.workspaceId }, select: { id: true } })
  if (!finding) throw new Error("health_finding_not_found")
  return prisma.healthCheckResult.update({
    where: { id: finding.id },
    data: { status: "dismissed", dismissedAt: new Date(), dismissedById: input.actorId },
  })
}

export async function undismissHealthFinding(input: { workspaceId: string; findingId: string }) {
  const finding = await prisma.healthCheckResult.findFirst({ where: { id: input.findingId, workspaceId: input.workspaceId }, select: { id: true } })
  if (!finding) throw new Error("health_finding_not_found")
  return prisma.healthCheckResult.update({
    where: { id: finding.id },
    data: { status: "open", dismissedAt: null, dismissedById: null },
  })
}

/** A manual resolve — a person confirming they've handled a finding — distinct from
 * runHealthChecks' own auto-resolve pass (which never sets resolvedById). */
export async function resolveHealthFinding(input: { workspaceId: string; findingId: string; actorId: string; action?: string }) {
  const finding = await prisma.healthCheckResult.findFirst({ where: { id: input.findingId, workspaceId: input.workspaceId }, select: { id: true } })
  if (!finding) throw new Error("health_finding_not_found")
  return prisma.healthCheckResult.update({
    where: { id: finding.id },
    data: { status: "resolved", resolvedAt: new Date(), resolvedById: input.actorId, resolvedAction: input.action ?? "manual" },
  })
}

// ---- Bank reconciliation dashboard ---------------------------------------------------------------

export type BankReconciliationStatementSummary = {
  documentId: string
  fileId: string
  filename: string
  receivedAt: Date
  transactionCount: number
  matchedCount: number
  unmatchedCount: number
}

export type BankReconciliationSummary = {
  totalIn: number
  totalOut: number
  statementCount: number
  mostRecentReceivedAt: Date | null
  totalTransactions: number
  matchedTransactions: number
  unmatchedTransactions: number
  statements: BankReconciliationStatementSummary[]
}

/** The data behind components/health/bank-reconciliation-card.tsx's dedicated dashboard for the
 * "bank_reconciliation" check — a pure DB read, no scoring/finding logic (that's
 * lib/health/checks/bank-reconciliation.ts's job). Reuses the same accepted-BankMatch-count query
 * loadBankStatements uses for CheckContext assembly, plus the credit/debit sums the check itself
 * has no reason to compute (a finding doesn't need "total money in/out", only staleness). Never
 * throws past the caller — an empty-but-valid summary on error, same posture as
 * getProjectedHealthScore. */
export async function getBankReconciliationSummary(workspaceId: string): Promise<BankReconciliationSummary> {
  const empty = { totalIn: 0, totalOut: 0, statementCount: 0, mostRecentReceivedAt: null, totalTransactions: 0, matchedTransactions: 0, unmatchedTransactions: 0, statements: [] }
  try {
    const documents = await prisma.document.findMany({
      where: { workspaceId, status: { notIn: ["received", "queued", "processing"] }, template: { code: "bank_statement" } },
      select: { id: true, fileId: true, filename: true, receivedAt: true, reviewedData: true },
      orderBy: { receivedAt: "desc" },
      take: CANDIDATE_CAP,
    })
    if (!documents.length) return empty

    const acceptedCounts = await loadAcceptedBankMatchCounts(workspaceId, documents.map((d) => d.id))

    let totalIn = 0
    let totalOut = 0
    let totalTransactions = 0
    let matchedTransactions = 0
    const statements: BankReconciliationStatementSummary[] = documents.map((document) => {
      const values = (document.reviewedData ?? {}) as Record<string, unknown>
      const rows = Array.isArray(values.transactions) ? (values.transactions as unknown[]) : []
      for (const row of rows) {
        const r = (row ?? {}) as Record<string, unknown>
        totalIn += asNumber(r.credit) ?? 0
        totalOut += asNumber(r.debit) ?? 0
      }
      const transactionCount = rows.length
      const matchedCount = Math.min(acceptedCounts.get(document.id) ?? 0, transactionCount)
      totalTransactions += transactionCount
      matchedTransactions += matchedCount
      return {
        documentId: document.id, fileId: document.fileId, filename: document.filename, receivedAt: document.receivedAt,
        transactionCount, matchedCount, unmatchedCount: transactionCount - matchedCount,
      }
    })

    return {
      totalIn, totalOut, statementCount: documents.length,
      mostRecentReceivedAt: documents[0]?.receivedAt ?? null,
      totalTransactions, matchedTransactions, unmatchedTransactions: totalTransactions - matchedTransactions,
      statements,
    }
  } catch (error) {
    console.error("[health] failed to compute bank reconciliation summary:", error instanceof Error ? error.message : error)
    return empty
  }
}

// ---- Scoring ------------------------------------------------------------------------------------

// Every registered check, ledger ones included — computeAndSnapshotHealthScore below decides at
// run time (via runnableChecks(ctx.ledger !== null)) which of these are actually applicable for a
// given workspace; a ledger check simply never appears in `inputs` when there's no connection, so
// carrying its default weight here unconditionally is harmless.
const DEFAULT_WEIGHTS: Record<string, number> = Object.fromEntries(REGISTRY.map((check) => [check.code, check.defaultWeight]))

export function toDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

/** Loads the current open findings + HealthScoreConfig, computes today's score
 * (lib/health/score.ts), and upserts today's HealthScore row — a same-day rerun updates the row
 * in place rather than accumulating duplicates, thanks to the (workspaceId, computedOn) unique
 * constraint. */
export async function computeAndSnapshotHealthScore(workspaceId: string, now: Date = new Date()): Promise<HealthScoreResult> {
  const configRows = await prisma.healthScoreConfig.findMany({ where: { workspaceId }, select: { checkCode: true, enabled: true, weight: true } })

  // The persisted HealthCheckResult rows carry no "applicable population" or per-finding
  // affectedCount (those only exist on the in-memory HealthFinding at run time), so the
  // applicable/failed counts scoring needs are rebuilt by re-running every check purely in memory
  // against a freshly assembled CheckContext — the same thing runHealthChecks does, just without
  // the DB round-trip of persisting each finding. This keeps computeAndSnapshotHealthScore usable
  // right after (or independently of) runHealthChecks, as a pure read + pure compute.
  const ctx = await buildCheckContext(workspaceId, now)
  const inputs: CheckScoreInput[] = runnableChecks(ctx.ledger !== null).map((check) => {
    const result = check.run(ctx)
    const failedCount = result.findings.reduce((sum, finding) => sum + finding.affectedCount, 0)
    return { checkCode: check.code, applicableCount: result.applicableCount, failedCount }
  })

  const config: HealthScoreConfigInput[] = configRows.map((row) => ({ checkCode: row.checkCode, enabled: row.enabled, weight: row.weight }))
  const result = computeHealthScore(inputs, config, DEFAULT_WEIGHTS)

  if (result.score !== null) {
    const computedOn = toDateOnly(now)
    await prisma.healthScore.upsert({
      where: { workspaceId_computedOn: { workspaceId, computedOn } },
      create: { workspaceId, computedOn, score: result.score, breakdown: result.breakdown as unknown as Prisma.InputJsonValue },
      update: { score: result.score, breakdown: result.breakdown as unknown as Prisma.InputJsonValue },
    })
  }

  return result
}

export const getHealthScoreHistory = cache(async (workspaceId: string, days = 30) => {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return prisma.healthScore.findMany({
    where: { workspaceId, computedOn: { gte: toDateOnly(since) } },
    orderBy: { computedOn: "asc" },
    select: { computedOn: true, score: true, breakdown: true },
  })
})

const HEALTH_CHECK_WORKSPACE_BATCH = 200

/** Phase B: runs Phase A + Phase B's health checks and snapshots today's score for every workspace
 * that (a) has the "data-health" module enabled and (b) hasn't already had a score computed today
 * — so a second cron hit the same day is a no-op, not a re-run. Called from
 * app/api/internal/jobs/process/route.ts's cron drain; never throws past the caller, same posture
 * as runHealthChecks itself (one workspace's failure is logged and skipped, not fatal to the
 * drain). Returns how many workspaces it ran checks for. */
export async function runDueHealthChecks(now: Date = new Date()): Promise<number> {
  const computedOn = toDateOnly(now)
  const candidates = await prisma.workspace.findMany({
    where: { healthScores: { none: { computedOn } } },
    select: { id: true },
    take: HEALTH_CHECK_WORKSPACE_BATCH,
  })
  if (!candidates.length) return 0

  let ran = 0
  for (const workspace of candidates) {
    try {
      const capabilities = await getWorkspaceCapabilities(workspace.id)
      if (!capabilities.has("data-health")) continue
      await runHealthChecks(workspace.id)
      await computeAndSnapshotHealthScore(workspace.id, now)
      ran++
    } catch (error) {
      console.error(`[health] failed to run due health checks for workspace ${workspace.id}:`, error instanceof Error ? error.message : error)
    }
  }
  return ran
}

// ---- Phase E: predictive score -----------------------------------------------------------------

/** A pending document ("not yet pushed" — no succeeded IntegrationPush, per
 * CheckDocumentSlice.pushedExternalBillId) as it would look the instant it pushed to the ledger:
 * a synthetic LedgerTransactionSlice standing in for the real provider row a push would create,
 * and the same document with hasPush/pushedExternalBillId flipped on. This is the only "simulation"
 * getProjectedHealthScore does — no provider is ever called; every value here already lives in
 * Postgres via ctx.documents. The synthetic externalId is namespaced "pending:<documentId>" so it
 * can never collide with a real externalId a provider actually assigned. */
function toSyntheticLedgerTransaction(document: CheckDocumentSlice): LedgerTransactionSlice {
  return {
    id: `pending:${document.id}`,
    externalId: `pending:${document.id}`,
    kind: "bill",
    contactExternalId: null,
    contactName: document.supplierValue,
    accountExternalId: null,
    accountName: null,
    docNumber: null,
    amount: null,
    taxAmount: document.extractedTaxTotal ?? null,
    currencyCode: null,
    txnDate: document.receivedAt,
    reconciled: false,
    active: true,
  }
}

function scoreInputsFor(checks: ReturnType<typeof runnableChecks>, ctx: CheckContext): CheckScoreInput[] {
  return checks.map((check) => {
    const result = check.run(ctx)
    const failedCount = result.findings.reduce((sum, finding) => sum + finding.affectedCount, 0)
    return { checkCode: check.code, applicableCount: result.applicableCount, failedCount }
  })
}

/** Phase E: `null` when there is no active accounting connection (nothing to project a push
 * against) or no pending document (the current score already IS the projection — nothing would
 * change). Otherwise builds the same CheckContext machinery runHealthChecks/
 * computeAndSnapshotHealthScore already build (buildCheckContext, not duplicated), plus one
 * variant of it whose ledger.transactions carries a synthetic row per pending document
 * (toSyntheticLedgerTransaction above) and whose documents carry that same document with hasPush/
 * pushedExternalBillId set as if the push had just succeeded — the minimum mutation needed for
 * tax_mismatch.ts and missing_tax.ts to naturally pick up each pending document exactly as they
 * would a real pushed one, with no change to either check's own logic.
 *
 * Known gap: ledger_duplicate.ts keys off LedgerTransactionSlice.contactExternalId (a provider
 * contact id) and amount — CheckDocumentSlice carries neither (no provider contact link exists
 * before a real push, and no extracted invoice total is exposed on the slice today), so a pending
 * document can never register as a projected duplicate here. Reusing ledger_duplicate's matching
 * as-is for a pending document would need CheckDocumentSlice to carry those two fields, which is a
 * larger, unrelated change to Phase A-C's document loader — left as a real limitation rather than
 * forced through with a fabricated contact id. */
export type ProjectedHealthScoreResult = ProjectedScoreResult & {
  /** How many not-yet-pushed documents fed the projection — the "if N pending documents push
   * as-is" headline count. Deliberately not part of lib/health/score.ts's ProjectedScoreResult:
   * that type is the pure scoring output, this is DB-derived population size. */
  pendingDocumentCount: number
}

export async function getProjectedHealthScore(workspaceId: string): Promise<ProjectedHealthScoreResult | null> {
  try {
    const connection = await prisma.integrationConnection.findFirst({ where: { workspaceId, status: "active" }, select: { id: true } })
    if (!connection) return null

    const now = new Date()
    const ctx = await buildCheckContext(workspaceId, now)
    if (!ctx.ledger) return null

    const pendingDocuments = ctx.documents.filter((document) => !document.pushedExternalBillId)
    if (!pendingDocuments.length) return null

    const pendingIds = new Set(pendingDocuments.map((document) => document.id))
    const projectedCtx: CheckContext = {
      ...ctx,
      documents: ctx.documents.map((document) =>
        pendingIds.has(document.id)
          ? { ...document, hasPush: true, pushedExternalBillId: `pending:${document.id}` }
          : document,
      ),
      ledger: { ...ctx.ledger, transactions: [...ctx.ledger.transactions, ...pendingDocuments.map(toSyntheticLedgerTransaction)] },
    }

    const checks = runnableChecks(true)
    const currentInputs = scoreInputsFor(checks, ctx)
    const projectedInputs = scoreInputsFor(checks, projectedCtx)

    const configRows = await prisma.healthScoreConfig.findMany({ where: { workspaceId }, select: { checkCode: true, enabled: true, weight: true } })
    const config: HealthScoreConfigInput[] = configRows.map((row) => ({ checkCode: row.checkCode, enabled: row.enabled, weight: row.weight }))

    return { ...projectHealthScore(currentInputs, projectedInputs, config, DEFAULT_WEIGHTS), pendingDocumentCount: pendingDocuments.length }
  } catch (error) {
    console.error("[health] failed to compute projected health score:", error instanceof Error ? error.message : error)
    return null
  }
}
