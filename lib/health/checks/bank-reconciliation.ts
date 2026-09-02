/** Surfaces DocuBite's existing bank-statement-document reconciliation feature
 * (lib/bank-match/matcher.ts + models/bank-matches.ts + the BankMatch model) inside Data Health —
 * distinct from unreconciled-transactions.ts (Phase B, ledger-side, requiresLedger: true), this
 * check works purely off uploaded `bank_statement`-template documents and their BankMatch rows, so
 * it has something to say even for a workspace with no accounting connection at all.
 *
 * One finding per stale statement (mirrors review-backlog.ts's day-threshold style): a statement
 * counts as stale once it has been sitting for more than BANK_RECONCILIATION_STALE_DAYS with at
 * least one transaction row still lacking an accepted BankMatch. A statement that's either fully
 * matched or still fresh produces no finding. */
import type { BankStatementSlice, CheckDefinition, CheckRunResult, HealthFinding } from "@/lib/health/types"

export const BANK_RECONCILIATION_STALE_DAYS = 7

function daysOld(receivedAt: Date, now: Date): number {
  return (now.getTime() - receivedAt.getTime()) / (24 * 60 * 60 * 1000)
}

function unmatchedCount(statement: BankStatementSlice): number {
  return Math.max(0, statement.transactionCount - statement.acceptedMatchCount)
}

function findingFor(statement: BankStatementSlice, ageDays: number): HealthFinding {
  const unmatched = unmatchedCount(statement)
  return {
    checkCode: "bank_reconciliation",
    category: "cleanup",
    severity: "warning",
    title: `${unmatched} unmatched transaction${unmatched === 1 ? "" : "s"} in "${statement.filename}"`,
    description: `This bank statement was received ${Math.floor(ageDays)} days ago and still has ${unmatched} of its ${statement.transactionCount} transactions without an accepted match.`,
    documentId: statement.documentId,
    suggestedAction: null,
    suggestedActionPayload: null,
    affectedCount: unmatched,
  }
}

export const bankReconciliationCheck: CheckDefinition = {
  code: "bank_reconciliation",
  name: "Bank reconciliation",
  category: "cleanup",
  defaultWeight: 1,
  // Unlike its Phase B cleanup siblings, this check needs zero ledger/accounting-provider
  // connection — it works purely off uploaded bank statement documents and existing BankMatch
  // rows, which is exactly why it's worth having even for a pipeline-only workspace.
  requiresLedger: false,
  run: (ctx): CheckRunResult => {
    const applicableCount = ctx.bankStatements.reduce((sum, statement) => sum + statement.transactionCount, 0)
    if (!ctx.bankStatements.length) return { findings: [], applicableCount: 0 }

    const findings: HealthFinding[] = []
    for (const statement of ctx.bankStatements) {
      const ageDays = daysOld(statement.receivedAt, ctx.dateRange.to)
      if (ageDays <= BANK_RECONCILIATION_STALE_DAYS) continue
      if (unmatchedCount(statement) === 0) continue
      findings.push(findingFor(statement, ageDays))
    }

    return { findings, applicableCount }
  },
}
