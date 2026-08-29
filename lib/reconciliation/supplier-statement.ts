import { amountsMatch } from "@/lib/checks/types"
import type { MatchCandidateDocument, MatchSuggestion } from "@/lib/bank-match/matcher"

export type SupplierStatementEntry = {
  index: number
  date: Date | null
  description: string | null
  amount: number | null
}

const PRIMARY_CONFIDENCE = 0.9
const FALLBACK_CONFIDENCE = 0.6
const DATE_WINDOW_DAYS = 30

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000)
}

/** True when the candidate's own invoice number appears as a whole token inside the entry's
 * description — "INV-1042 payment" contains "INV-1042", but "INV-104" does not, so a shorter
 * invoice number that happens to be a substring of a longer one never false-positives. */
function invoiceNumberInDescription(invoiceNumber: string, description: string): boolean {
  const needle = invoiceNumber.trim().toLowerCase()
  if (!needle) return false
  const tokens = description.toLowerCase().split(/[^a-z0-9-]+/)
  return tokens.includes(needle)
}

/** WP2.3's own matcher, distinct from lib/bank-match/matcher.ts: a supplier statement's entries
 * are for ONE supplier (the caller pre-filters candidates to that supplier), and its rows usually
 * cite the invoice number directly — a much stronger signal than a bank statement's free-text
 * description ever gives, so it is tried first and given a higher confidence than any amount/date
 * fallback could earn. Candidates are already fuzzy-filtered to the statement's own supplier by
 * the caller (models/bank-matches.ts) — this matches within that pre-filtered set only. */
export function matchSupplierStatementEntries(entries: SupplierStatementEntry[], candidates: MatchCandidateDocument[], opts?: { statementCurrency?: string | null }): MatchSuggestion[] {
  const statementCurrency = opts?.statementCurrency ?? null
  const usedEntries = new Set<number>()
  const usedDocuments = new Set<string>()
  const suggestions: MatchSuggestion[] = []

  // Primary pass: invoice number cited in the entry's own description.
  for (const entry of entries) {
    if (!entry.description) continue
    const match = candidates.find((candidate) => candidate.invoiceNumber && invoiceNumberInDescription(candidate.invoiceNumber, entry.description as string) && !usedDocuments.has(candidate.documentId))
    if (!match) continue
    usedEntries.add(entry.index)
    usedDocuments.add(match.documentId)
    const dateDeltaDays = entry.date && match.date ? daysBetween(entry.date, match.date) : null
    suggestions.push({ transactionIndex: entry.index, documentId: match.documentId, confidence: PRIMARY_CONFIDENCE, dateDeltaDays })
  }

  // Fallback pass: amount + date proximity, for entries the primary pass didn't resolve.
  const scored: { transactionIndex: number; documentId: string; confidence: number; dateDeltaDays: number | null }[] = []
  for (const entry of entries) {
    if (usedEntries.has(entry.index) || entry.amount === null) continue
    for (const candidate of candidates) {
      if (usedDocuments.has(candidate.documentId) || candidate.total === null) continue
      if (statementCurrency && candidate.currencyCode && statementCurrency.toUpperCase() !== candidate.currencyCode.toUpperCase()) continue
      if (!amountsMatch(entry.amount, candidate.total, statementCurrency ?? candidate.currencyCode)) continue
      const dateDeltaDays = entry.date && candidate.date ? daysBetween(entry.date, candidate.date) : null
      if (dateDeltaDays !== null && dateDeltaDays > DATE_WINDOW_DAYS) continue
      scored.push({ transactionIndex: entry.index, documentId: candidate.documentId, confidence: FALLBACK_CONFIDENCE, dateDeltaDays })
    }
  }
  scored.sort((a, b) => (a.dateDeltaDays ?? Infinity) - (b.dateDeltaDays ?? Infinity))
  for (const candidate of scored) {
    if (usedEntries.has(candidate.transactionIndex) || usedDocuments.has(candidate.documentId)) continue
    usedEntries.add(candidate.transactionIndex)
    usedDocuments.add(candidate.documentId)
    suggestions.push(candidate)
  }

  return suggestions
}
