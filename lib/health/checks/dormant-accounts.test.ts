import { describe, expect, it } from "vitest"
import { dormantAccountsCheck } from "@/lib/health/checks/dormant-accounts"
import type { CheckContext, LedgerAccountingEntitySlice, LedgerTransactionSlice } from "@/lib/health/types"

const now = new Date("2026-09-02T00:00:00.000Z")
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000)

function account(overrides: Partial<LedgerAccountingEntitySlice> = {}): LedgerAccountingEntitySlice {
  return { id: "id1", externalId: "a1", entityType: "account", name: "Office expenses", active: true, ...overrides }
}

function txn(overrides: Partial<LedgerTransactionSlice> = {}): LedgerTransactionSlice {
  return {
    id: "t1", externalId: "e1", kind: "bill", contactExternalId: "v1", contactName: "Acme",
    accountExternalId: "a1", accountName: "Office expenses", docNumber: "INV-1", amount: 100,
    taxAmount: null, currencyCode: "USD", txnDate: now, reconciled: false, active: true,
    ...overrides,
  }
}

function baseCtx(accountingEntities: LedgerAccountingEntitySlice[], transactions: LedgerTransactionSlice[] = []): CheckContext {
  return {
    workspaceId: "ws1", dateRange: { from: now, to: now },
    ledger: { transactions, accountingEntities, matchCandidateDocuments: [] },
    documents: [], reviewTasks: [], pushHistory: [], automationRules: [], checkResults: [],
    confidenceDrift: [], lowConfidenceFields: [], bankStatements: [],
  }
}

describe("dormantAccountsCheck", () => {
  it("flags an active account with no recent postings", () => {
    const result = dormantAccountsCheck.run(baseCtx([account()], []))
    expect(result.findings).toHaveLength(1)
  })

  it("does not flag an account posted to within 90 days", () => {
    const result = dormantAccountsCheck.run(baseCtx([account()], [txn({ txnDate: daysAgo(10) })]))
    expect(result.findings).toHaveLength(0)
  })

  it("flags an account whose only posting is over 90 days old", () => {
    const result = dormantAccountsCheck.run(baseCtx([account()], [txn({ txnDate: daysAgo(120) })]))
    expect(result.findings).toHaveLength(1)
  })

  it("ignores inactive accounts", () => {
    const result = dormantAccountsCheck.run(baseCtx([account({ active: false })], []))
    expect(result.applicableCount).toBe(0)
  })
})
