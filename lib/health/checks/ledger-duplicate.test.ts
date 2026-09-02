import { describe, expect, it } from "vitest"
import { ledgerDuplicateCheck } from "@/lib/health/checks/ledger-duplicate"
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

describe("ledgerDuplicateCheck", () => {
  it("flags two transactions with the same contact, close amount, and close date", () => {
    const result = ledgerDuplicateCheck.run(baseCtx([
      txn({ id: "t1", externalId: "e1" }),
      txn({ id: "t2", externalId: "e2", txnDate: new Date(now.getTime() + 24 * 60 * 60 * 1000) }),
    ]))
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].affectedCount).toBe(2)
  })

  it("does not flag transactions for different contacts", () => {
    const result = ledgerDuplicateCheck.run(baseCtx([
      txn({ id: "t1", externalId: "e1", contactExternalId: "v1" }),
      txn({ id: "t2", externalId: "e2", contactExternalId: "v2" }),
    ]))
    expect(result.findings).toHaveLength(0)
  })

  it("does not flag transactions with different amounts", () => {
    const result = ledgerDuplicateCheck.run(baseCtx([
      txn({ id: "t1", externalId: "e1", amount: 100 }),
      txn({ id: "t2", externalId: "e2", amount: 500 }),
    ]))
    expect(result.findings).toHaveLength(0)
  })

  it("does not flag transactions far apart in date", () => {
    const result = ledgerDuplicateCheck.run(baseCtx([
      txn({ id: "t1", externalId: "e1", txnDate: now }),
      txn({ id: "t2", externalId: "e2", txnDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) }),
    ]))
    expect(result.findings).toHaveLength(0)
  })

  it("reports zero applicable when ledger has no active transactions", () => {
    const result = ledgerDuplicateCheck.run(baseCtx([]))
    expect(result.applicableCount).toBe(0)
    expect(result.findings).toHaveLength(0)
  })
})
