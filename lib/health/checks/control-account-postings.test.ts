import { describe, expect, it } from "vitest"
import { controlAccountPostingsCheck } from "@/lib/health/checks/control-account-postings"
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

describe("controlAccountPostingsCheck", () => {
  it("flags a posting to Accounts Payable", () => {
    const result = controlAccountPostingsCheck.run(baseCtx([
      txn({ accountName: "Accounts Payable (A/P)" }),
    ]))
    expect(result.findings).toHaveLength(1)
  })

  it("flags a posting to Undeposited Funds", () => {
    const result = controlAccountPostingsCheck.run(baseCtx([
      txn({ accountName: "Undeposited Funds" }),
    ]))
    expect(result.findings).toHaveLength(1)
  })

  it("does not flag an ordinary expense account", () => {
    const result = controlAccountPostingsCheck.run(baseCtx([
      txn({ accountName: "Office expenses" }),
    ]))
    expect(result.findings).toHaveLength(0)
  })

  it("ignores transactions with no account coded", () => {
    const result = controlAccountPostingsCheck.run(baseCtx([
      txn({ accountExternalId: null, accountName: null }),
    ]))
    expect(result.applicableCount).toBe(0)
  })
})
