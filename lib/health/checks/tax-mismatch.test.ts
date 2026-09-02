import { describe, expect, it } from "vitest"
import { taxMismatchCheck } from "@/lib/health/checks/tax-mismatch"
import type { CheckContext, CheckDocumentSlice, LedgerTransactionSlice } from "@/lib/health/types"

const now = new Date("2026-09-02T00:00:00.000Z")

function doc(overrides: Partial<CheckDocumentSlice> = {}): CheckDocumentSlice {
  return {
    id: "d1", fileId: "f1", filename: "invoice.pdf", templateCode: "invoice", status: "extracted",
    receivedAt: now, supplierValue: "Acme", supplierConfidence: null, hasPush: true, hasRejectedReviewTask: false,
    pushedExternalBillId: "e1", extractedTaxTotal: 10, taxExpected: true,
    ...overrides,
  }
}

function txn(overrides: Partial<LedgerTransactionSlice> = {}): LedgerTransactionSlice {
  return {
    id: "t1", externalId: "e1", kind: "bill", contactExternalId: "v1", contactName: "Acme",
    accountExternalId: "a1", accountName: "Office expenses", docNumber: "INV-1", amount: 100,
    taxAmount: 10, currencyCode: "USD", txnDate: now, reconciled: false, active: true,
    ...overrides,
  }
}

function baseCtx(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    workspaceId: "ws1", dateRange: { from: now, to: now }, ledger: { transactions: [], accountingEntities: [], matchCandidateDocuments: [] },
    documents: [], reviewTasks: [], pushHistory: [], automationRules: [], checkResults: [],
    confidenceDrift: [], lowConfidenceFields: [], bankStatements: [],
    ...overrides,
  }
}

describe("taxMismatchCheck", () => {
  it("passes when the extracted tax total matches the ledger", () => {
    const result = taxMismatchCheck.run(baseCtx({ documents: [doc()], ledger: { transactions: [txn()], accountingEntities: [], matchCandidateDocuments: [] } }))
    expect(result.findings).toHaveLength(0)
    expect(result.applicableCount).toBe(1)
  })

  it("flags a mismatch as a warning", () => {
    const result = taxMismatchCheck.run(baseCtx({ documents: [doc({ extractedTaxTotal: 25 })], ledger: { transactions: [txn({ taxAmount: 10 })], accountingEntities: [], matchCandidateDocuments: [] } }))
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].severity).toBe("warning")
  })

  it("degrades to info when the ledger has no tax breakdown for this provider (e.g. QuickBooks/Xero)", () => {
    const result = taxMismatchCheck.run(baseCtx({ documents: [doc()], ledger: { transactions: [txn({ taxAmount: null })], accountingEntities: [], matchCandidateDocuments: [] } }))
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].severity).toBe("info")
  })

  it("ignores a document with no extracted tax total at all", () => {
    const result = taxMismatchCheck.run(baseCtx({ documents: [doc({ extractedTaxTotal: null })] }))
    expect(result.applicableCount).toBe(0)
    expect(result.findings).toHaveLength(0)
  })

  it("ignores an unpushed document", () => {
    const result = taxMismatchCheck.run(baseCtx({ documents: [doc({ pushedExternalBillId: null })] }))
    expect(result.applicableCount).toBe(0)
  })

  it("skips a document whose pushed bill isn't found in the synced ledger", () => {
    const result = taxMismatchCheck.run(baseCtx({ documents: [doc()], ledger: { transactions: [], accountingEntities: [], matchCandidateDocuments: [] } }))
    expect(result.applicableCount).toBe(1)
    expect(result.findings).toHaveLength(0)
  })
})
