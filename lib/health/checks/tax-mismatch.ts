/** Phase C: flags a pushed document whose extracted tax_total disagrees with the tax amount the
 * accounting provider actually recorded for the bill it produced — the same kind of drift
 * push_failures.ts/ledger_duplicate.ts catch for other fields, but for tax specifically. Compares
 * CheckDocumentSlice.extractedTaxTotal (the DocumentFieldValue this app extracted, surfaced by
 * models/health.ts's loadDocuments) against LedgerTransactionSlice.taxAmount for the matching
 * pushed transaction, joined by externalId (CheckDocumentSlice.pushedExternalBillId, set from the
 * document's most recent successful IntegrationPush.externalBillId).
 *
 * Provider caveat (see the Phase C report): QuickBooks' and Xero's ledger-sync mappings
 * (lib/health/sync.ts) never populate LedgerTransactionSlice.taxAmount — neither provider's Bill/
 * Purchase/Invoice list query used there requests a tax breakdown field, so taxAmount is always
 * null for those two providers today. Rather than silently skip (a false "nothing to report") or
 * crash on the null, a pushed+taxed document whose ledger row has no taxAmount at all produces an
 * "info" finding saying so — exactly the degrade-to-info posture the plan calls for whenever the
 * data needed to actually verify tax isn't available from the provider. Bigcapital's bill sync does
 * populate taxAmount (tax_amount_withheld), so that provider gets the real warning-level check. */
import { amountsMatch } from "@/lib/checks/types"
import type { CheckDefinition, CheckDocumentSlice, CheckRunResult, LedgerTransactionSlice } from "@/lib/health/types"

function findLedgerMatch(document: CheckDocumentSlice, transactions: LedgerTransactionSlice[]): LedgerTransactionSlice | null {
  if (!document.pushedExternalBillId) return null
  return transactions.find((t) => t.active && t.externalId === document.pushedExternalBillId) ?? null
}

export const taxMismatchCheck: CheckDefinition = {
  code: "tax_mismatch",
  name: "Tax total doesn't match the ledger",
  category: "tax",
  defaultWeight: 2,
  requiresLedger: true,
  run: (ctx): CheckRunResult => {
    const candidates = ctx.documents.filter((document) => document.pushedExternalBillId && document.extractedTaxTotal !== null && document.extractedTaxTotal !== undefined)
    const transactions = ctx.ledger?.transactions ?? []
    const applicableCount = candidates.length
    if (!applicableCount) return { findings: [], applicableCount }

    const findings: CheckRunResult["findings"] = []
    for (const document of candidates) {
      const match = findLedgerMatch(document, transactions)
      if (!match) continue
      const extractedTaxTotal = document.extractedTaxTotal as number

      if (match.taxAmount === null) {
        findings.push({
          checkCode: "tax_mismatch",
          category: "tax",
          severity: "info",
          title: `Tax data not available from the ledger for ${document.filename}`,
          description: `This document extracted a tax total of ${extractedTaxTotal}, but the accounting provider's record for this bill carries no tax breakdown to verify it against.`,
          documentId: document.id,
          externalTransactionId: match.externalId,
          suggestedAction: null,
          suggestedActionPayload: { extractedTaxTotal },
          affectedCount: 1,
        })
        continue
      }

      if (!amountsMatch(extractedTaxTotal, match.taxAmount, match.currencyCode)) {
        findings.push({
          checkCode: "tax_mismatch",
          category: "tax",
          severity: "warning",
          title: `Tax mismatch on ${document.filename}`,
          description: `Extracted tax total is ${extractedTaxTotal}, but the ledger record for this bill has ${match.taxAmount}.`,
          documentId: document.id,
          externalTransactionId: match.externalId,
          suggestedAction: null,
          suggestedActionPayload: { extractedTaxTotal, ledgerTaxAmount: match.taxAmount },
          affectedCount: 1,
        })
      }
    }

    return { findings, applicableCount }
  },
}
