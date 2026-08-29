// Deliberately NOT a "use server" module, matching every other models/*.ts helper: trusts the
// workspaceId/documentId it is handed. Server actions live in
// app/(app)/workspaces/[workspaceId]/bank-match-actions.ts and do the auth + capability gate.
import { auditEventData, getRequestAuditContext } from "@/lib/audit"
import { suggestMatches, type BankTransaction, type MatchCandidateDocument } from "@/lib/bank-match/matcher"
import { prisma } from "@/lib/db"
import { matchSupplierStatementEntries, type SupplierStatementEntry } from "@/lib/reconciliation/supplier-statement"
import { Prisma } from "@/prisma/client"
import { cache } from "react"

/** Which reviewedData keys carry the concepts the matchers need, per template — the same "per-
 * template field name" problem models/document-checks.ts's CHECK_FIELD_MAPS solves, kept as its
 * own small map here rather than importing that one: this needs different fields (amount/date
 * shapes for statement rows) that CHECK_FIELD_MAPS has no reason to carry. */
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

async function loadCandidateDocuments(workspaceId: string, excludeDocumentId: string): Promise<MatchCandidateDocument[]> {
  const templateCodes = Object.keys(CANDIDATE_FIELD_MAPS)
  const documents = await prisma.document.findMany({
    where: { workspaceId, id: { not: excludeDocumentId }, status: { notIn: ["received", "queued", "processing"] }, template: { code: { in: templateCodes } } },
    select: { id: true, reviewedData: true, template: { select: { code: true } } },
    take: 500,
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

/** Deletes every non-accepted BankMatch row for this (statement, kind) before inserting fresh
 * suggestions — an accepted match is a person's decision and must survive a re-run; a stale
 * "suggested" or "rejected" row from a prior run has no reason to. */
async function replaceSuggestions(workspaceId: string, statementDocumentId: string, kind: string, suggestions: { transactionIndex: number; matchedDocumentId: string; confidence: number; dateDeltaDays: number | null }[]): Promise<void> {
  await prisma.$transaction([
    prisma.bankMatch.deleteMany({ where: { workspaceId, statementDocumentId, kind, status: { not: "accepted" } } }),
    ...suggestions.map((s) => prisma.bankMatch.upsert({
      where: { workspaceId_kind_statementDocumentId_transactionIndex_matchedDocumentId: { workspaceId, kind, statementDocumentId, transactionIndex: s.transactionIndex, matchedDocumentId: s.matchedDocumentId } },
      create: { workspaceId, statementDocumentId, kind, transactionIndex: s.transactionIndex, matchedDocumentId: s.matchedDocumentId, confidence: s.confidence, dateDeltaDays: s.dateDeltaDays },
      update: { confidence: s.confidence, dateDeltaDays: s.dateDeltaDays, status: "suggested", decidedById: null, decidedAt: null },
    })),
  ])
}

/** Regenerates "bank" suggestions for one bank_statement document — matches each transaction row
 * against every invoice/receipt/expense_receipt document in the workspace not already excluded.
 * Never throws past the caller, matching every other post-extraction side effect in
 * lib/document-processing.ts. */
export async function regenerateBankMatchSuggestions(workspaceId: string, statementDocumentId: string): Promise<void> {
  try {
    const document = await prisma.document.findFirst({
      where: { id: statementDocumentId, workspaceId },
      select: { id: true, reviewedData: true, template: { select: { code: true } } },
    })
    if (document?.template?.code !== "bank_statement") return
    const values = (document.reviewedData ?? {}) as Record<string, unknown>
    const statementCurrency = asString(values.currency_code)
    const rows = Array.isArray(values.transactions) ? (values.transactions as unknown[]) : []
    const transactions: BankTransaction[] = rows.map((row, index) => {
      const r = (row ?? {}) as Record<string, unknown>
      const debit = asNumber(r.debit)
      const credit = asNumber(r.credit)
      return { index, date: asDate(r.transaction_date), description: asString(r.description), amount: debit ?? credit }
    })
    if (!transactions.length) { await replaceSuggestions(workspaceId, statementDocumentId, "bank", []); return }

    const candidates = await loadCandidateDocuments(workspaceId, statementDocumentId)
    const suggestions = suggestMatches(transactions, candidates, { statementCurrency })
    await replaceSuggestions(workspaceId, statementDocumentId, "bank", suggestions.map((s) => ({ transactionIndex: s.transactionIndex, matchedDocumentId: s.documentId, confidence: s.confidence, dateDeltaDays: s.dateDeltaDays })))
  } catch (error) {
    console.error("[bank-match] failed to regenerate suggestions:", error instanceof Error ? error.message : error)
  }
}

/** Regenerates "supplier_statement" suggestions — matches each statement entry against the
 * workspace's invoices from the same supplier (lib/reconciliation/supplier-statement.ts's own,
 * stricter matcher: invoice-number-in-description first, amount+date fallback second). */
export async function regenerateSupplierStatementMatches(workspaceId: string, statementDocumentId: string): Promise<void> {
  try {
    const document = await prisma.document.findFirst({
      where: { id: statementDocumentId, workspaceId },
      select: { id: true, reviewedData: true, template: { select: { code: true } } },
    })
    if (document?.template?.code !== "supplier_statement") return
    const values = (document.reviewedData ?? {}) as Record<string, unknown>
    const statementSupplier = asString(values.supplier)
    const statementCurrency = asString(values.currency_code)
    const rows = Array.isArray(values.entries) ? (values.entries as unknown[]) : []
    const entries: SupplierStatementEntry[] = rows.map((row, index) => {
      const r = (row ?? {}) as Record<string, unknown>
      return { index, date: asDate(r.entry_date), description: asString(r.description), amount: asNumber(r.amount) }
    })
    if (!entries.length) { await replaceSuggestions(workspaceId, statementDocumentId, "supplier_statement", []); return }

    const allInvoices = await loadCandidateDocuments(workspaceId, statementDocumentId)
    // Pre-filtered to invoices whose vendor fuzzy-matches the statement's own supplier — a supplier
    // statement should never match an unrelated supplier's invoice just because the amount lines up.
    const candidates = statementSupplier
      ? allInvoices.filter((candidate) => candidate.supplier && fuzzySupplierMatch(candidate.supplier, statementSupplier))
      : []
    const suggestions = matchSupplierStatementEntries(entries, candidates, { statementCurrency })
    await replaceSuggestions(workspaceId, statementDocumentId, "supplier_statement", suggestions.map((s) => ({ transactionIndex: s.transactionIndex, matchedDocumentId: s.documentId, confidence: s.confidence, dateDeltaDays: s.dateDeltaDays })))
  } catch (error) {
    console.error("[bank-match] failed to regenerate supplier statement matches:", error instanceof Error ? error.message : error)
  }
}

function fuzzySupplierMatch(a: string, b: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  const na = normalize(a)
  const nb = normalize(b)
  return na === nb || na.includes(nb) || nb.includes(na)
}

export const listBankMatches = cache(async (workspaceId: string, statementDocumentId: string) => prisma.bankMatch.findMany({
  where: { workspaceId, statementDocumentId },
  orderBy: { transactionIndex: "asc" },
  include: { matchedDocument: { select: { id: true, filename: true, reviewedData: true } } },
}))

export async function decideBankMatch(input: { workspaceId: string; matchId: string; status: "accepted" | "rejected"; actorId: string }) {
  const match = await prisma.bankMatch.findFirst({ where: { id: input.matchId, workspaceId: input.workspaceId }, select: { id: true, statementDocumentId: true, transactionIndex: true, kind: true } })
  if (!match) throw new Error("bank_match_not_found")
  const context = await getRequestAuditContext()
  const [updated] = await prisma.$transaction([
    prisma.bankMatch.update({ where: { id: match.id }, data: { status: input.status, decidedById: input.actorId, decidedAt: new Date() } }),
    prisma.documentAuditEvent.create({ data: auditEventData({ workspaceId: input.workspaceId, documentId: match.statementDocumentId, actorId: input.actorId, type: `bank_match.${input.status}`, detail: { matchId: match.id, transactionIndex: match.transactionIndex, kind: match.kind } as Prisma.InputJsonValue }, context) }),
  ])
  return updated
}
