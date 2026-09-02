import { describe, expect, it } from "vitest"
import { unreconciledTransactionsCheck } from "@/lib/health/checks/unreconciled-transactions"
import type { CheckContext, LedgerTransactionSlice } from "@/lib/health/types"
import type { MatchCandidateDocument } from "@/lib/bank-match/matcher"

const now = new Date("2026-09-02T00:00:00.000Z")

function txn(overrides: Partial<LedgerTransactionSlice> = {}): LedgerTransactionSlice {
  return {
    id: "t1", externalId: "e1", kind: "bill", contactExternalId: "v1", contactName: "Acme",
    accountExternalId: "a1", accountName: "Office expenses", docNumber: "INV-1", amount: 100,
    taxAmount: null, currencyCode: "USD", txnDate: now, reconciled: false, active: true,
    ...overrides,
  }
}

function baseCtx(transactions: LedgerTransactionSlice[], matchCandidateDocuments: MatchCandidateDocument[] = []): CheckContext {
  return {
    workspaceId: "ws1", dateRange: { from: now, to: now },
    ledger: { transactions, accountingEntities: [], matchCandidateDocuments },
    documents: [], reviewTasks: [], pushHistory: [], automationRules: [], checkResults: [],
    confidenceDrift: [], lowConfidenceFields: [], bankStatements: [],
  }
}

describe("unreconciledTransactionsCheck", () => {
  it("reports zero applicable when nothing is unreconciled", () => {
    const result = unreconciledTransactionsCheck.run(baseCtx([txn({ reconciled: true })]))
    expect(result.applicableCount).toBe(0)
    expect(result.findings).toHaveLength(0)
  })

  it("flags unreconciled transactions with no matching document", () => {
    const result = unreconciledTransactionsCheck.run(baseCtx([txn({ reconciled: false })]))
    expect(result.applicableCount).toBe(1)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].affectedCount).toBe(1)
    expect(result.findings[0].description).toContain("none of them matched")
  })

  it("notes how many unreconciled transactions already match a document", () => {
    const result = unreconciledTransactionsCheck.run(baseCtx(
      [txn({ reconciled: false, amount: 250, txnDate: now })],
      [{ documentId: "doc1", supplier: "Acme", total: 250, date: now, currencyCode: "USD" }],
    ))
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].description).toContain("1 of these 1")
  })
})
