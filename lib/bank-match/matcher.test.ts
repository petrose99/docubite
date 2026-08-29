import { describe, expect, it } from "vitest"
import { suggestMatches, type BankTransaction, type MatchCandidateDocument } from "@/lib/bank-match/matcher"

const txn = (overrides: Partial<BankTransaction> = {}): BankTransaction => ({ index: 0, date: new Date("2026-08-10"), description: "PAYMENT TO ACME LTD", amount: 100, ...overrides })
const doc = (overrides: Partial<MatchCandidateDocument> = {}): MatchCandidateDocument => ({ documentId: "d1", supplier: "Acme Ltd", total: 100, date: new Date("2026-08-10"), currencyCode: "USD", ...overrides })

describe("suggestMatches", () => {
  it("matches an exact amount, date, and supplier with high confidence", () => {
    const result = suggestMatches([txn()], [doc()])
    expect(result).toEqual([{ transactionIndex: 0, documentId: "d1", confidence: 1, dateDeltaDays: 0 }])
  })

  it("does not suggest a match when the amount differs", () => {
    expect(suggestMatches([txn({ amount: 50 })], [doc()])).toEqual([])
  })

  it("excludes a candidate whose currency differs from the statement's", () => {
    expect(suggestMatches([txn()], [doc({ currencyCode: "GBP" })], { statementCurrency: "USD" })).toEqual([])
  })

  it("decays the date bonus linearly and drops it entirely outside the 14-day window", () => {
    const near = suggestMatches([txn({ date: new Date("2026-08-17") })], [doc({ date: new Date("2026-08-10"), supplier: null })])
    const far = suggestMatches([txn({ date: new Date("2026-09-10") })], [doc({ date: new Date("2026-08-10"), supplier: null })])
    expect(near[0]?.confidence).toBeCloseTo(0.6 + 0.25 * 0.5, 5)
    // Outside the window the date bonus is dropped, so only the amount-match base (0.6) remains.
    expect(far[0]?.confidence).toBeCloseTo(0.6, 5)
  })

  it("scores supplier-token overlap even with no date match", () => {
    const result = suggestMatches([txn({ date: null })], [doc({ date: null })])
    expect(result[0]?.confidence).toBeCloseTo(0.6 + 0.15, 5)
  })

  it("requires at least the amount-match confidence to suggest anything", () => {
    // No date, no supplier overlap: amount alone (0.6) still clears the 0.6 threshold.
    const result = suggestMatches([txn({ date: null, description: "unrelated text" })], [doc({ date: null, supplier: "Acme Ltd" })])
    expect(result[0]?.confidence).toBeCloseTo(0.6, 5)
  })

  it("never suggests the same document for two transactions", () => {
    const txns = [txn({ index: 0 }), txn({ index: 1 })]
    const result = suggestMatches(txns, [doc()])
    expect(result).toHaveLength(1)
  })

  it("never gives one transaction two suggestions, picking the higher-confidence candidate", () => {
    const candidates = [doc({ documentId: "weak", supplier: null }), doc({ documentId: "strong", supplier: "Acme Ltd" })]
    const result = suggestMatches([txn()], candidates)
    expect(result).toHaveLength(1)
    expect(result[0].documentId).toBe("strong")
  })

  it("resolves a genuine one-to-one assignment even when both documents fit both transactions", () => {
    const txns = [txn({ index: 0, date: new Date("2026-08-10") }), txn({ index: 1, date: new Date("2026-08-12") })]
    const candidates = [doc({ documentId: "d1", date: new Date("2026-08-10") }), doc({ documentId: "d2", date: new Date("2026-08-12") })]
    const result = suggestMatches(txns, candidates)
    expect(result).toHaveLength(2)
    expect(result.find((r) => r.transactionIndex === 0)?.documentId).toBe("d1")
    expect(result.find((r) => r.transactionIndex === 1)?.documentId).toBe("d2")
  })

  it("returns nothing for a transaction or candidate with no amount", () => {
    expect(suggestMatches([txn({ amount: null })], [doc()])).toEqual([])
    expect(suggestMatches([txn()], [doc({ total: null })])).toEqual([])
  })
})
