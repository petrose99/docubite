import { describe, expect, it } from "vitest"
import { uncodedTransactionsCheck } from "@/lib/health/checks/uncoded-transactions"
import type { CheckContext, LedgerTransactionSlice } from "@/lib/health/types"

const now = new Date("2026-09-02T00:00:00.000Z")

function txn(overrides: Partial<LedgerTransactionSlice> = {}): LedgerTransactionSlice {
  return {
    id: "t1", externalId: "e1", kind: "bill", contactExternalId: "v1", contactName: "Acme",
    accountExternalId: "a1", accountName: "Office expenses", docNumber: "INV-1", amount: 100,
    taxAmount: null, currencyCode: "USD", txnDate: now, reconciled: false, active: true,
    ...overrides,
  }
}

function baseCtx(transactions: LedgerTransactionSlice[]): CheckContext {
  return {
    workspaceId: "ws1", dateRange: { from: now, to: now },
    ledger: { transactions, accountingEntities: [], matchCandidateDocuments: [] },
    documents: [], reviewTasks: [], pushHistory: [], automationRules: [], checkResults: [],
    confidenceDrift: [], lowConfidenceFields: [], bankStatements: [],
  }
}

describe("uncodedTransactionsCheck", () => {
  it("flags a transaction with no account coded", () => {
    const result = uncodedTransactionsCheck.run(baseCtx([txn({ accountExternalId: null })]))
    expect(result.findings).toHaveLength(1)
  })

  it("does not flag a coded transaction", () => {
    const result = uncodedTransactionsCheck.run(baseCtx([txn({ accountExternalId: "a1" })]))
    expect(result.findings).toHaveLength(0)
  })

  it("ignores inactive transactions", () => {
    const result = uncodedTransactionsCheck.run(baseCtx([txn({ accountExternalId: null, active: false })]))
    expect(result.applicableCount).toBe(0)
  })
})
