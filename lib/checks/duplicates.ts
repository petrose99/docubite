import { amountsMatch, type CheckResult } from "@/lib/checks/types"

export type DocumentIdentity = {
  documentId: string
  supplier: string | null
  invoiceNumber: string | null
  total: number | null
  currencyCode: string | null
}

/** Exact duplicates are caught earlier, at ingestion (WP9's IngestionItem idempotency key) — this
 * is the near-dupe case that key can never catch: the SAME invoice, re-scanned or re-photographed,
 * producing different bytes but the same supplier + invoice number + total. Warn, not fail (unlike
 * the exact-duplicate check) — a genuine credit note or a corrected re-issue can legitimately share
 * all three fields with an unrelated document.
 *
 * `others` is every other document's identity in scope for comparison (same workspace, same
 * template) — gathering that list is models/document-checks.ts's job; this stays pure over
 * whatever list it's handed, which is what makes it exhaustively table-testable. */
export function findNearDuplicate(candidate: DocumentIdentity, others: DocumentIdentity[]): CheckResult | null {
  if (!candidate.supplier?.trim() || !candidate.invoiceNumber?.trim() || candidate.total === null) return null

  const supplier = candidate.supplier.trim().toLowerCase()
  const invoiceNumber = candidate.invoiceNumber.trim().toLowerCase()
  const match = others.find((other) =>
    other.documentId !== candidate.documentId
    && (other.supplier ?? "").trim().toLowerCase() === supplier
    && (other.invoiceNumber ?? "").trim().toLowerCase() === invoiceNumber
    && other.total !== null && amountsMatch(other.total, candidate.total as number, candidate.currencyCode))

  if (!match) return { checkCode: "duplicate", status: "pass", message: "No near-duplicate found." }
  return {
    checkCode: "duplicate", status: "warn", detail: { matchedDocumentId: match.documentId },
    message: "Same supplier, invoice number, and total as another document already in this workspace.",
  }
}
