import { describe, expect, it } from "vitest"
import { multiCodedContactsCheck } from "@/lib/health/checks/multi-coded-contacts"
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

describe("multiCodedContactsCheck", () => {
  it("flags a contact posted to two different accounts", () => {
    const result = multiCodedContactsCheck.run(baseCtx([
      txn({ id: "t1", externalId: "e1", accountExternalId: "a1", accountName: "Office expenses" }),
      txn({ id: "t2", externalId: "e2", accountExternalId: "a2", accountName: "Rent" }),
    ]))
    expect(result.findings).toHaveLength(1)
    expect(result.applicableCount).toBe(1)
  })

  it("does not flag a contact consistently posted to one account", () => {
    const result = multiCodedContactsCheck.run(baseCtx([
      txn({ id: "t1", externalId: "e1", accountExternalId: "a1" }),
      txn({ id: "t2", externalId: "e2", accountExternalId: "a1" }),
    ]))
    expect(result.findings).toHaveLength(0)
  })

  it("ignores transactions with no account or no contact", () => {
    const result = multiCodedContactsCheck.run(baseCtx([
      txn({ id: "t1", externalId: "e1", accountExternalId: null }),
      txn({ id: "t2", externalId: "e2", contactExternalId: null }),
    ]))
    expect(result.applicableCount).toBe(0)
    expect(result.findings).toHaveLength(0)
  })
})
