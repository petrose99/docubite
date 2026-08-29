import { describe, expect, it } from "vitest"
import { matchSupplierStatementEntries, type SupplierStatementEntry } from "@/lib/reconciliation/supplier-statement"
import type { MatchCandidateDocument } from "@/lib/bank-match/matcher"

const entry = (overrides: Partial<SupplierStatementEntry> = {}): SupplierStatementEntry => ({ index: 0, date: new Date("2026-08-10"), description: "Invoice INV-1042", amount: 100, ...overrides })
const doc = (overrides: Partial<MatchCandidateDocument> = {}): MatchCandidateDocument => ({ documentId: "d1", supplier: "Acme", total: 100, date: new Date("2026-08-01"), currencyCode: "USD", invoiceNumber: "INV-1042", ...overrides })

describe("matchSupplierStatementEntries", () => {
  it("matches primarily on the invoice number cited in the description, regardless of amount", () => {
    const result = matchSupplierStatementEntries([entry({ amount: 999 })], [doc()])
    expect(result).toEqual([{ transactionIndex: 0, documentId: "d1", confidence: 0.9, dateDeltaDays: 9 }])
  })

  it("does not primary-match a shorter invoice number that is only a substring of the cited one (falls back to amount+date instead)", () => {
    const result = matchSupplierStatementEntries([entry({ description: "Invoice INV-104" })], [doc({ invoiceNumber: "INV-1042" })])
    // Not a primary (0.9) match — only the amount/date fallback (0.6) resolves it.
    expect(result[0]?.confidence).toBe(0.6)
  })

  it("falls back to amount + date proximity when no invoice number is cited", () => {
    const result = matchSupplierStatementEntries([entry({ description: "Payment received", amount: 100 })], [doc({ invoiceNumber: null, date: new Date("2026-08-05") })])
    expect(result).toEqual([{ transactionIndex: 0, documentId: "d1", confidence: 0.6, dateDeltaDays: 5 }])
  })

  it("excludes a fallback candidate whose currency differs from the statement's", () => {
    const result = matchSupplierStatementEntries([entry({ description: "Payment", amount: 100 })], [doc({ invoiceNumber: null, currencyCode: "GBP" })], { statementCurrency: "USD" })
    expect(result).toEqual([])
  })

  it("excludes a fallback candidate outside the date window", () => {
    const result = matchSupplierStatementEntries([entry({ description: "Payment", date: new Date("2026-08-10"), amount: 100 })], [doc({ invoiceNumber: null, date: new Date("2026-01-01") })])
    expect(result).toEqual([])
  })

  it("never assigns the same document to two entries", () => {
    const entries = [entry({ index: 0 }), entry({ index: 1 })]
    const result = matchSupplierStatementEntries(entries, [doc()])
    expect(result).toHaveLength(1)
  })

  it("prefers the invoice-number match over a fallback match for a different entry on the same document", () => {
    const entries = [entry({ index: 0, description: "Payment", amount: 100 }), entry({ index: 1, description: "Invoice INV-1042", amount: 999 })]
    const result = matchSupplierStatementEntries(entries, [doc()])
    expect(result).toEqual([{ transactionIndex: 1, documentId: "d1", confidence: 0.9, dateDeltaDays: expect.any(Number) }])
  })
})
