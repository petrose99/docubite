/** Phase B: flags a LedgerTransaction posted directly to a control/system account — Accounts
 * Payable, Accounts Receivable, Undeposited Funds, Opening Balance, Retained Earnings — which
 * should normally only move as a side effect of another transaction (paying a bill, depositing
 * funds), never posted to directly.
 *
 * Detection is name-based, not type-based: none of the three provider clients' account-list calls
 * (quickbooks.listAccounts, xero.listAccounts, bigcapital.listAccounts — see
 * lib/integrations/sync.ts) fetch or cache an account-type/classification field today, only
 * id/name/active (AccountingEntity has nothing else to read — same gap contact-defaults-missing.ts
 * hit for vendors). A live check against a real Bigcapital instance during this phase's
 * verification confirmed real control accounts always carry one of these exact names ("Accounts
 * Payable (A/P)", "Accounts Receivable (A/R)", "Undeposited Funds", "Opening Balance Equity",
 * "Retained Earnings"), so name matching is a reasonable stand-in until the sync caches real
 * account-type data. */
import type { CheckDefinition, CheckRunResult } from "@/lib/health/types"

const CONTROL_ACCOUNT_NAME_PATTERNS = [
  /accounts?\s*payable/i,
  /accounts?\s*receivable/i,
  /undeposited\s*funds/i,
  /opening\s*balance/i,
  /retained\s*earnings/i,
]

function isControlAccountName(name: string | null): boolean {
  if (!name) return false
  return CONTROL_ACCOUNT_NAME_PATTERNS.some((pattern) => pattern.test(name))
}

export const controlAccountPostingsCheck: CheckDefinition = {
  code: "control_account_postings",
  name: "Postings to control accounts",
  category: "cleanup",
  defaultWeight: 1,
  requiresLedger: true,
  run: (ctx): CheckRunResult => {
    const transactions = (ctx.ledger?.transactions ?? []).filter((t) => t.active && t.accountExternalId)
    const applicableCount = transactions.length
    if (!applicableCount) return { findings: [], applicableCount }

    const findings = transactions
      .filter((t) => isControlAccountName(t.accountName))
      .map((t) => ({
        checkCode: "control_account_postings",
        category: "cleanup" as const,
        severity: "warning" as const,
        title: `${t.kind === "bill" ? "Bill" : t.kind === "expense" ? "Expense" : "Transaction"} posted directly to "${t.accountName}"`,
        description: `${t.docNumber ?? t.externalId} posted directly to a control account ("${t.accountName}"), which usually indicates miscoding — control accounts are normally only touched by other transactions, not posted to directly.`,
        externalTransactionId: t.externalId,
        suggestedAction: null,
        suggestedActionPayload: null,
        affectedCount: 1,
      }))

    return { findings, applicableCount }
  },
}
