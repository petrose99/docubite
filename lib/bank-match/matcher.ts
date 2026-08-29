import { amountsMatch } from "@/lib/checks/types"

export type BankTransaction = {
  index: number
  date: Date | null
  description: string | null
  /** Absolute value of whichever side (debit or credit) the statement row carries — the sign is
   * meaningless for matching purposes, only the magnitude is compared against a document's total. */
  amount: number | null
}

export type MatchCandidateDocument = {
  documentId: string
  supplier: string | null
  total: number | null
  date: Date | null
  currencyCode: string | null
  /** Only populated for templates that carry one (invoices/receipts) — used by
   * lib/reconciliation/supplier-statement.ts's stricter primary match, not by this matcher. */
  invoiceNumber?: string | null
}

export type MatchSuggestion = {
  transactionIndex: number
  documentId: string
  confidence: number
  dateDeltaDays: number | null
}

const DATE_WINDOW_DAYS = 14
const CONFIDENCE_THRESHOLD = 0.6
const AMOUNT_WEIGHT = 0.6
const DATE_WEIGHT = 0.25
const SUPPLIER_WEIGHT = 0.15

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000)
}

function tokenize(value: string | null): Set<string> {
  if (!value) return new Set()
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3))
}

/** How much of the description's wording overlaps the candidate's supplier name — a description
 * often embeds the supplier ("PAYMENT TO ACME LTD"), so token overlap is a workable cheap proxy
 * without any external entity-resolution step. Ratio is over the supplier's own token count: a
 * short supplier name fully present in a long description should score as a full match. */
function supplierOverlapRatio(supplier: string | null, description: string | null): number {
  const supplierTokens = tokenize(supplier)
  if (!supplierTokens.size) return 0
  const descriptionTokens = tokenize(description)
  let hits = 0
  for (const token of supplierTokens) if (descriptionTokens.has(token)) hits++
  return hits / supplierTokens.size
}

function scoreMatch(txn: BankTransaction, candidate: MatchCandidateDocument, statementCurrency: string | null): { confidence: number; dateDeltaDays: number | null } | null {
  if (txn.amount === null || candidate.total === null) return null
  if (statementCurrency && candidate.currencyCode && statementCurrency.toUpperCase() !== candidate.currencyCode.toUpperCase()) return null
  if (!amountsMatch(txn.amount, candidate.total, statementCurrency ?? candidate.currencyCode)) return null

  let confidence = AMOUNT_WEIGHT
  let dateDeltaDays: number | null = null
  if (txn.date && candidate.date) {
    dateDeltaDays = daysBetween(txn.date, candidate.date)
    if (dateDeltaDays <= DATE_WINDOW_DAYS) confidence += DATE_WEIGHT * (1 - dateDeltaDays / DATE_WINDOW_DAYS)
  }
  confidence += SUPPLIER_WEIGHT * supplierOverlapRatio(candidate.supplier, txn.description)

  return { confidence, dateDeltaDays }
}

/** Suggests, for each bank/statement transaction, at most one candidate document it likely
 * corresponds to — greedy highest-confidence-first assignment so no document is suggested for two
 * transactions and no transaction gets two suggestions, even when several transactions could
 * plausibly match the same document (a repeat payment amount, say). Pure: the caller
 * (models/bank-matches.ts) gathers the transactions and in-period candidate documents; this only
 * scores and assigns. */
export function suggestMatches(transactions: BankTransaction[], candidates: MatchCandidateDocument[], opts?: { statementCurrency?: string | null }): MatchSuggestion[] {
  const statementCurrency = opts?.statementCurrency ?? null
  const scored: { transactionIndex: number; documentId: string; confidence: number; dateDeltaDays: number | null }[] = []

  for (const txn of transactions) {
    for (const candidate of candidates) {
      const result = scoreMatch(txn, candidate, statementCurrency)
      if (result && result.confidence >= CONFIDENCE_THRESHOLD) {
        scored.push({ transactionIndex: txn.index, documentId: candidate.documentId, confidence: result.confidence, dateDeltaDays: result.dateDeltaDays })
      }
    }
  }

  scored.sort((a, b) => b.confidence - a.confidence)

  const usedTransactions = new Set<number>()
  const usedDocuments = new Set<string>()
  const suggestions: MatchSuggestion[] = []
  for (const candidate of scored) {
    if (usedTransactions.has(candidate.transactionIndex) || usedDocuments.has(candidate.documentId)) continue
    usedTransactions.add(candidate.transactionIndex)
    usedDocuments.add(candidate.documentId)
    suggestions.push(candidate)
  }
  return suggestions
}
