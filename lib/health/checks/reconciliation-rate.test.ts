import { describe, expect, it } from "vitest"
import { reconciliationRateCheck } from "@/lib/health/checks/reconciliation-rate"
import type { CheckContext, LedgerTransactionSlice } from "@/lib/health/types"

const to = new Date("2026-09-02T00:00:00.000Z")
const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
const txnDate = new Date(from.getTime() + 24 * 60 * 60 * 1000)

function txn(id: string, overrides: Partial<LedgerTransactionSlice> = {}): LedgerTransactionSlice {
  return {
    id, externalId: `ext-${id}`, kind: "bill", contactExternalId: null, contactName: null,
    accountExternalId: null, accountName: null, docNumber: null, amount: 100, taxAmount: null,
    currencyCode: "USD", txnDate, reconciled: false, active: true,
    ...overrides,
  }
}

function baseCtx(transactions: LedgerTransactionSlice[]): CheckContext {
  return {
    workspaceId: "ws1", dateRange: { from, to },
    ledger: { transactions, accountingEntities: [], matchCandidateDocuments: [] },
    documents: [], reviewTasks: [], pushHistory: [], automationRules: [], checkResults: [],
    confidenceDrift: [], lowConfidenceFields: [], bankStatements: [],
  }
}

describe("reconciliationRateCheck", () => {
  it("is always applicable when ledger is present, even with no transactions", () => {
    const result = reconciliationRateCheck.run(baseCtx([]))
    expect(result.applicableCount).toBe(1)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].title).toBe("No ledger transactions this period")
  })

  it("computes the reconciled rate over transactions dated in the period", () => {
    const transactions = [txn("1", { reconciled: true }), txn("2", { reconciled: true }), txn("3", { reconciled: false })]
    const result = reconciliationRateCheck.run(baseCtx(transactions))
    const payload = result.findings[0].suggestedActionPayload as { reconciledCount: number; totalCount: number; rate: number }
    expect(payload.reconciledCount).toBe(2)
    expect(payload.totalCount).toBe(3)
    expect(payload.rate).toBeCloseTo((2 / 3) * 100)
  })

  it("excludes inactive transactions and ones outside the period", () => {
    const transactions = [
      txn("1", { reconciled: true, active: false }),
      txn("2", { reconciled: true, txnDate: new Date(from.getTime() - 1000) }),
      txn("3", { reconciled: true, txnDate: null }),
    ]
    const result = reconciliationRateCheck.run(baseCtx(transactions))
    const payload = result.findings[0].suggestedActionPayload as { totalCount: number }
    expect(payload.totalCount).toBe(0)
  })
})
