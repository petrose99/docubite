import { describe, expect, it } from "vitest"
import { bankReconciliationCheck } from "@/lib/health/checks/bank-reconciliation"
import type { BankStatementSlice, CheckContext } from "@/lib/health/types"

const now = new Date("2026-09-02T00:00:00.000Z")

function baseCtx(overrides: Partial<CheckContext> = {}): CheckContext {
  return {
    workspaceId: "ws1",
    dateRange: { from: new Date("2026-08-03T00:00:00.000Z"), to: now },
    ledger: null,
    documents: [],
    reviewTasks: [],
    pushHistory: [],
    automationRules: [],
    checkResults: [],
    confidenceDrift: [],
    lowConfidenceFields: [],
    bankStatements: [],
    ...overrides,
  }
}

function statement(overrides: Partial<BankStatementSlice> = {}): BankStatementSlice {
  return {
    documentId: "doc1",
    fileId: "file1",
    filename: "August statement.pdf",
    receivedAt: now,
    transactionCount: 10,
    acceptedMatchCount: 0,
    ...overrides,
  }
}

describe("bankReconciliationCheck", () => {
  it("reports applicableCount 0 and no findings with no bank statement documents", () => {
    const result = bankReconciliationCheck.run(baseCtx())
    expect(result.applicableCount).toBe(0)
    expect(result.findings).toHaveLength(0)
  })

  it("does not flag a recent statement even with unmatched transactions", () => {
    const recent = statement({ receivedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), transactionCount: 5, acceptedMatchCount: 1 })
    const result = bankReconciliationCheck.run(baseCtx({ bankStatements: [recent] }))
    expect(result.findings).toHaveLength(0)
    expect(result.applicableCount).toBe(5)
  })

  it("flags a stale statement with unmatched transactions", () => {
    const old = statement({ receivedAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000), transactionCount: 5, acceptedMatchCount: 2 })
    const result = bankReconciliationCheck.run(baseCtx({ bankStatements: [old] }))
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].affectedCount).toBe(3)
    expect(result.findings[0].documentId).toBe("doc1")
  })

  it("does not flag a stale statement that is fully matched", () => {
    const old = statement({ receivedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), transactionCount: 5, acceptedMatchCount: 5 })
    const result = bankReconciliationCheck.run(baseCtx({ bankStatements: [old] }))
    expect(result.findings).toHaveLength(0)
    expect(result.applicableCount).toBe(5)
  })

  it("produces one finding per stale statement", () => {
    const staleA = statement({ documentId: "docA", receivedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000), transactionCount: 4, acceptedMatchCount: 1 })
    const staleB = statement({ documentId: "docB", receivedAt: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000), transactionCount: 6, acceptedMatchCount: 3 })
    const fresh = statement({ documentId: "docC", receivedAt: now, transactionCount: 3, acceptedMatchCount: 0 })
    const result = bankReconciliationCheck.run(baseCtx({ bankStatements: [staleA, staleB, fresh] }))
    expect(result.findings).toHaveLength(2)
    expect(result.findings.map((f) => f.documentId).sort()).toEqual(["docA", "docB"])
    expect(result.applicableCount).toBe(13)
  })
})
