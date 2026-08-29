import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/prisma/client", () => ({ Prisma: { JsonNull: null } }))
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }))
vi.mock("@/models/review-tasks", () => ({ createReviewTask: vi.fn() }))
vi.mock("@/models/tax-profiles", () => ({ getTaxProfile: vi.fn().mockResolvedValue(null) }))

const { runDeterministicChecks } = await import("@/models/document-checks")
const { prisma } = await import("@/lib/db")
const { track } = await import("@/lib/analytics")
const { createReviewTask } = await import("@/models/review-tasks")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(db)) delete db[key]
  db.documentCheckResult = { upsert: vi.fn() }
  db.reviewTask = { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) }
  db.document = { findMany: vi.fn().mockResolvedValue([]) }
  db.ingestionItem = { findFirst: vi.fn().mockResolvedValue(null) }
})

const invoiceDocument = (reviewedData: Record<string, unknown>) => ({
  id: "d1", templateId: "t1", reviewedData, template: { code: "invoice" },
})

describe("runDeterministicChecks", () => {
  it("does nothing for a template with no check field map", async () => {
    db.document = { findFirst: vi.fn().mockResolvedValue({ id: "d1", templateId: "t1", reviewedData: {}, template: { code: "generic" } }), findMany: vi.fn() }
    await runDeterministicChecks({ workspaceId: "w1", documentId: "d1" })
    expect(db.documentCheckResult.upsert).not.toHaveBeenCalled()
  })

  it("does nothing when the document or its template is missing", async () => {
    db.document = { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn() }
    await runDeterministicChecks({ workspaceId: "w1", documentId: "d1" })
    expect(db.documentCheckResult.upsert).not.toHaveBeenCalled()
  })

  it("persists a failing arithmetic result and opens a review task", async () => {
    db.document = {
      findFirst: vi.fn().mockResolvedValue(invoiceDocument({ vendor: "Acme", invoice_number: "INV-1", subtotal: 100, tax_total: 20, total: 999, currency_code: "USD" })),
      findMany: vi.fn().mockResolvedValue([]),
    }

    await runDeterministicChecks({ workspaceId: "w1", documentId: "d1" })

    expect(db.documentCheckResult.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { documentId_checkCode: { documentId: "d1", checkCode: "invoice_arithmetic" } },
      create: expect.objectContaining({ status: "fail" }),
    }))
    expect(track).toHaveBeenCalledWith("document_check_failed", { documentId: "d1", checkCode: "invoice_arithmetic", status: "fail" }, { workspaceId: "w1" })
    expect(createReviewTask).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "w1", documentId: "d1", reason: "check_failed" }))
  })

  it("persists a passing result without opening a review task", async () => {
    db.document = {
      findFirst: vi.fn().mockResolvedValue(invoiceDocument({ vendor: "Acme", invoice_number: "INV-1", subtotal: 100, tax_total: 20, total: 120, currency_code: "USD" })),
      findMany: vi.fn().mockResolvedValue([]),
    }

    await runDeterministicChecks({ workspaceId: "w1", documentId: "d1" })

    expect(db.documentCheckResult.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ status: "pass" }) }))
    expect(createReviewTask).not.toHaveBeenCalled()
  })

  it("does not open a second review task when one is already open for the same check", async () => {
    db.document = {
      findFirst: vi.fn().mockResolvedValue(invoiceDocument({ vendor: "Acme", invoice_number: "INV-1", subtotal: 100, tax_total: 20, total: 999, currency_code: "USD" })),
      findMany: vi.fn().mockResolvedValue([]),
    }
    db.reviewTask.findFirst.mockResolvedValue({ id: "existing" })

    await runDeterministicChecks({ workspaceId: "w1", documentId: "d1" })

    expect(createReviewTask).not.toHaveBeenCalled()
  })

  it("marks an exact-ingestion duplicate as a failing duplicate check", async () => {
    db.document = { findFirst: vi.fn().mockResolvedValue(invoiceDocument({ vendor: "Acme", invoice_number: "INV-1", total: 100, currency_code: "USD" })), findMany: vi.fn().mockResolvedValue([]) }
    db.ingestionItem.findFirst.mockResolvedValue({ status: "duplicate" })

    await runDeterministicChecks({ workspaceId: "w1", documentId: "d1" })

    expect(db.documentCheckResult.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { documentId_checkCode: { documentId: "d1", checkCode: "duplicate" } },
      create: expect.objectContaining({ status: "fail" }),
    }))
  })

  it("swallows an internal error rather than throwing past the caller", async () => {
    db.document = { findFirst: vi.fn().mockRejectedValue(new Error("db down")) }
    await expect(runDeterministicChecks({ workspaceId: "w1", documentId: "d1" })).resolves.toBeUndefined()
  })

  it("warns when the supplier VAT number does not match the workspace's tax region format", async () => {
    const { getTaxProfile } = await import("@/models/tax-profiles")
    vi.mocked(getTaxProfile).mockResolvedValue({
      id: "tp1", region: "gb", currentVersion: 1,
      config: { region: "gb", name: "United Kingdom", currency: "GBP", taxType: "vat", rates: [], registrationNumberLabel: "VAT number", registrationNumberPattern: "^GB\\d{9}$", mtdReady: false, form1099Fields: [] },
    })
    db.document = {
      findFirst: vi.fn().mockResolvedValue(invoiceDocument({ vendor: "Acme", invoice_number: "INV-1", subtotal: 100, tax_total: 20, total: 120, currency_code: "GBP", supplier_vat_number: "FR123456789" })),
      findMany: vi.fn().mockResolvedValue([]),
    }

    await runDeterministicChecks({ workspaceId: "w1", documentId: "d1" })

    expect(db.documentCheckResult.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { documentId_checkCode: { documentId: "d1", checkCode: "vat_number_format" } },
      create: expect.objectContaining({ status: "warn" }),
    }))
  })

  it("does not run the VAT check when the field is absent", async () => {
    const { getTaxProfile } = await import("@/models/tax-profiles")
    vi.mocked(getTaxProfile).mockResolvedValue({
      id: "tp1", region: "gb", currentVersion: 1,
      config: { region: "gb", name: "United Kingdom", currency: "GBP", taxType: "vat", rates: [], registrationNumberLabel: "VAT number", registrationNumberPattern: "^GB\\d{9}$", mtdReady: false, form1099Fields: [] },
    })
    db.document = {
      findFirst: vi.fn().mockResolvedValue(invoiceDocument({ vendor: "Acme", invoice_number: "INV-1", subtotal: 100, tax_total: 20, total: 120, currency_code: "GBP" })),
      findMany: vi.fn().mockResolvedValue([]),
    }

    await runDeterministicChecks({ workspaceId: "w1", documentId: "d1" })

    expect(db.documentCheckResult.upsert).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { documentId_checkCode: { documentId: "d1", checkCode: "vat_number_format" } },
    }))
  })
})
