import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/prisma/client", () => ({ Prisma: { JsonNull: null } }))

const { decideBankMatch, regenerateBankMatchSuggestions, regenerateSupplierStatementMatches } = await import("@/models/bank-matches")
const { prisma } = await import("@/lib/db")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(db)) delete db[key]
  db.bankMatch = { deleteMany: vi.fn(), upsert: vi.fn(), findFirst: vi.fn(), update: vi.fn() }
  db.documentAuditEvent = { create: vi.fn() }
  db.$transaction = vi.fn((ops: unknown[]) => Promise.all(ops))
})

const bankStatementDoc = (transactions: unknown[]) => ({
  id: "stmt1", reviewedData: { currency_code: "USD", transactions }, template: { code: "bank_statement" },
})

describe("regenerateBankMatchSuggestions", () => {
  it("does nothing for a document that isn't a bank_statement", async () => {
    db.document = { findFirst: vi.fn().mockResolvedValue({ id: "d1", reviewedData: {}, template: { code: "invoice" } }) }
    await regenerateBankMatchSuggestions("w1", "d1")
    expect(db.bankMatch.deleteMany).not.toHaveBeenCalled()
  })

  it("clears suggestions and writes nothing new when the statement has no transactions", async () => {
    db.document = { findFirst: vi.fn().mockResolvedValue(bankStatementDoc([])) }
    await regenerateBankMatchSuggestions("w1", "stmt1")
    expect(db.bankMatch.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: "w1", statementDocumentId: "stmt1", kind: "bank", status: { not: "accepted" } } })
    expect(db.bankMatch.upsert).not.toHaveBeenCalled()
  })

  it("matches a transaction against a candidate invoice and upserts the suggestion", async () => {
    db.document = {
      findFirst: vi.fn()
        .mockResolvedValueOnce(bankStatementDoc([{ transaction_date: "2026-08-10", description: "PAYMENT TO ACME LTD", debit: 100 }])),
    }
    db.document.findMany = vi.fn().mockResolvedValue([
      { id: "inv1", reviewedData: { vendor: "Acme Ltd", total: 100, issue_date: "2026-08-10", currency_code: "USD" }, template: { code: "invoice" } },
    ])
    await regenerateBankMatchSuggestions("w1", "stmt1")
    expect(db.bankMatch.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ workspaceId: "w1", statementDocumentId: "stmt1", kind: "bank", transactionIndex: 0, matchedDocumentId: "inv1" }),
    }))
  })

  it("swallows an internal error rather than throwing past the caller", async () => {
    db.document = { findFirst: vi.fn().mockRejectedValue(new Error("db down")) }
    await expect(regenerateBankMatchSuggestions("w1", "stmt1")).resolves.toBeUndefined()
  })
})

describe("regenerateSupplierStatementMatches", () => {
  it("does nothing for a document that isn't a supplier_statement", async () => {
    db.document = { findFirst: vi.fn().mockResolvedValue({ id: "d1", reviewedData: {}, template: { code: "bank_statement" } }) }
    await regenerateSupplierStatementMatches("w1", "d1")
    expect(db.bankMatch.deleteMany).not.toHaveBeenCalled()
  })

  it("pre-filters candidates to invoices whose vendor fuzzy-matches the statement's supplier", async () => {
    db.document = {
      findFirst: vi.fn().mockResolvedValue({
        id: "stmt1", reviewedData: { supplier: "Acme Ltd", currency_code: "USD", entries: [{ entry_date: "2026-08-10", description: "Invoice INV-1", amount: 100 }] },
        template: { code: "supplier_statement" },
      }),
    }
    db.document.findMany = vi.fn().mockResolvedValue([
      { id: "inv-acme", reviewedData: { vendor: "Acme Ltd", total: 100, issue_date: "2026-08-01", currency_code: "USD", invoice_number: "INV-1" }, template: { code: "invoice" } },
      { id: "inv-other", reviewedData: { vendor: "Totally Different Co", total: 100, issue_date: "2026-08-01", currency_code: "USD", invoice_number: "INV-1" }, template: { code: "invoice" } },
    ])
    await regenerateSupplierStatementMatches("w1", "stmt1")
    expect(db.bankMatch.upsert).toHaveBeenCalledTimes(1)
    expect(db.bankMatch.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ matchedDocumentId: "inv-acme", kind: "supplier_statement" }),
    }))
  })
})

describe("decideBankMatch", () => {
  it("throws when the match does not belong to this workspace", async () => {
    db.bankMatch.findFirst.mockResolvedValue(null)
    await expect(decideBankMatch({ workspaceId: "w1", matchId: "m1", status: "accepted", actorId: "u1" })).rejects.toThrow("bank_match_not_found")
  })

  it("updates status and records an audit event", async () => {
    db.bankMatch.findFirst.mockResolvedValue({ id: "m1", statementDocumentId: "stmt1", transactionIndex: 0, kind: "bank" })
    db.bankMatch.update.mockResolvedValue({ id: "m1", status: "accepted" })
    await decideBankMatch({ workspaceId: "w1", matchId: "m1", status: "accepted", actorId: "u1" })
    expect(db.bankMatch.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "m1" }, data: expect.objectContaining({ status: "accepted", decidedById: "u1" }) }))
    expect(db.documentAuditEvent.create).toHaveBeenCalled()
  })
})
