/** Phase B: flags a near-duplicate pair of LedgerTransaction rows — same contact, close amount,
 * close date, different externalId. Adapts lib/checks/duplicates.ts's findNearDuplicate approach
 * (same amountsMatch tolerance, same "warn not fail" posture — a genuine credit note or a
 * corrected re-issue can legitimately look like this) to a date *window* rather than an exact-day
 * match, since ledger postings for the same real-world bill often land a day or two apart. */
import { amountsMatch } from "@/lib/checks/types"
import type { CheckDefinition, CheckRunResult, LedgerTransactionSlice } from "@/lib/health/types"

const DATE_WINDOW_DAYS = 3

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000)
}

function isNearDuplicate(a: LedgerTransactionSlice, b: LedgerTransactionSlice): boolean {
  if (!a.contactExternalId || a.contactExternalId !== b.contactExternalId) return false
  if (a.kind !== b.kind) return false
  if (a.amount === null || b.amount === null) return false
  if (!amountsMatch(a.amount, b.amount, a.currencyCode ?? b.currencyCode)) return false
  if (!a.txnDate || !b.txnDate) return false
  return daysBetween(a.txnDate, b.txnDate) <= DATE_WINDOW_DAYS
}

export const ledgerDuplicateCheck: CheckDefinition = {
  code: "ledger_duplicate",
  name: "Duplicate ledger transactions",
  category: "cleanup",
  defaultWeight: 1,
  requiresLedger: true,
  run: (ctx): CheckRunResult => {
    const transactions = (ctx.ledger?.transactions ?? []).filter((t) => t.active)
    const applicableCount = transactions.length
    if (!applicableCount) return { findings: [], applicableCount }

    const flagged = new Set<string>()
    const findings: CheckRunResult["findings"] = []

    for (let i = 0; i < transactions.length; i++) {
      const a = transactions[i]
      if (flagged.has(a.id)) continue
      for (let j = i + 1; j < transactions.length; j++) {
        const b = transactions[j]
        if (flagged.has(b.id)) continue
        if (!isNearDuplicate(a, b)) continue
        flagged.add(a.id)
        flagged.add(b.id)
        findings.push({
          checkCode: "ledger_duplicate",
          category: "cleanup",
          severity: "warning",
          title: `Possible duplicate: ${a.contactName ?? "a contact"} posted twice around the same date`,
          description: `${a.kind} ${a.docNumber ?? a.externalId} and ${b.kind} ${b.docNumber ?? b.externalId} share the same contact and a matching amount within ${DATE_WINDOW_DAYS} days of each other.`,
          externalTransactionId: a.externalId,
          // Phase C: the pair's *later*-dated transaction (b, since transactions arrives sorted no
          // particular way but this loop always compares i < j in whatever order ctx.ledger handed
          // them — pick deterministically by kind+date instead) is the one lib/health/actions.ts's
          // void_duplicate remediation offers to void, keeping "a" (this finding's own
          // externalTransactionId) as the transaction of record. Only ever offered for kind
          // "bill" — voidBill has no equivalent for a bank_transaction/expense on any provider
          // wired up so far; lib/health/actions.ts checks the kind again before acting on this.
          suggestedAction: a.kind === "bill" ? "void_duplicate" : null,
          suggestedActionPayload: { otherExternalTransactionId: b.externalId, kind: a.kind },
          affectedCount: 2,
        })
        break
      }
    }

    return { findings, applicableCount }
  },
}
