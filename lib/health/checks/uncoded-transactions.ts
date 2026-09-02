/** Phase B: flags a LedgerTransaction row with no accountExternalId at all — a bill/expense/bank
 * transaction that never got coded to an account, the most basic bookkeeping-hygiene gap. */
import type { CheckDefinition, CheckRunResult } from "@/lib/health/types"

export const uncodedTransactionsCheck: CheckDefinition = {
  code: "uncoded_transactions",
  name: "Uncoded ledger transactions",
  category: "cleanup",
  defaultWeight: 1,
  requiresLedger: true,
  run: (ctx): CheckRunResult => {
    const transactions = (ctx.ledger?.transactions ?? []).filter((t) => t.active)
    const applicableCount = transactions.length
    if (!applicableCount) return { findings: [], applicableCount }

    const findings = transactions
      .filter((t) => !t.accountExternalId)
      .map((t) => ({
        checkCode: "uncoded_transactions",
        category: "cleanup" as const,
        severity: "warning" as const,
        title: `${t.kind === "bill" ? "Bill" : t.kind === "expense" ? "Expense" : "Bank transaction"} ${t.docNumber ?? t.externalId} has no account coded`,
        description: `${t.contactName ? `From ${t.contactName}. ` : ""}This ledger transaction has no account assigned.`,
        externalTransactionId: t.externalId,
        suggestedAction: null,
        suggestedActionPayload: null,
        affectedCount: 1,
      }))

    return { findings, applicableCount }
  },
}
