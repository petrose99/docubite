/** Phase B: flags the workspace's unreconciled LedgerTransaction rows as one finding, calling out
 * how many of them already have a likely-matching DocuBite document — using
 * lib/bank-match/matcher.ts's suggestMatches exactly as the bank-statement matcher does. One
 * aggregate finding rather than one per transaction, since the population itself ("still
 * unreconciled") is the thing worth surfacing; the match count is a head start, not a separate
 * lesser defect. */
import { suggestMatches, type BankTransaction } from "@/lib/bank-match/matcher"
import type { CheckDefinition, CheckRunResult } from "@/lib/health/types"

export const unreconciledTransactionsCheck: CheckDefinition = {
  code: "unreconciled_transactions",
  name: "Unreconciled ledger transactions",
  category: "cleanup",
  defaultWeight: 1,
  requiresLedger: true,
  run: (ctx): CheckRunResult => {
    const unreconciled = (ctx.ledger?.transactions ?? []).filter((t) => t.active && !t.reconciled)
    const applicableCount = unreconciled.length
    if (!applicableCount) return { findings: [], applicableCount }

    const bankTransactions: BankTransaction[] = unreconciled.map((t, index) => ({
      index,
      date: t.txnDate,
      description: t.contactName ?? t.docNumber ?? null,
      amount: t.amount,
    }))
    const candidates = ctx.ledger?.matchCandidateDocuments ?? []
    const suggestions = suggestMatches(bankTransactions, candidates)

    // The "defect" this check scores against is simply "still unreconciled" — affectedCount
    // covers every unreconciled transaction, not just the matched subset, so the score reflects
    // the whole reconciliation backlog. The matched count is called out in the description as a
    // head start, not a separate lesser finding: it tells a person how many of these should be
    // quick to close out versus how many need real investigation.
    return {
      applicableCount,
      findings: [{
        checkCode: "unreconciled_transactions",
        category: "cleanup",
        severity: "info",
        title: `${applicableCount} unreconciled ledger transactions${suggestions.length ? ` — ${suggestions.length} already match a document you have` : ""}`,
        description: suggestions.length
          ? `${suggestions.length} of these ${applicableCount} ledger transactions already have a likely-matching document in DocuBite — worth reconciling first.`
          : `${applicableCount} ledger transactions are not yet marked reconciled, and none of them matched an existing document.`,
        suggestedAction: null,
        suggestedActionPayload: { transactionIndexes: suggestions.map((s) => s.transactionIndex) },
        affectedCount: applicableCount,
      }],
    }
  },
}
