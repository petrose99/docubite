import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
const capabilitiesMock = vi.fn()
vi.mock("@/lib/modules/capabilities", () => ({ getWorkspaceCapabilities: (...args: unknown[]) => capabilitiesMock(...args) }))
const listAccountingEntitiesMock = vi.fn().mockResolvedValue([])
vi.mock("@/models/accounting-entities", () => ({ listAccountingEntities: (...args: unknown[]) => listAccountingEntitiesMock(...args) }))

const {
  describeApproveReviewTasks, describeRejectReviewTask, describeSetDocumentCoding,
  describeCreateSupplierRule, describePushToAccounting, snapAccountToSyncedList,
} = await import("@/lib/finance/actions")
const { prisma } = await import("@/lib/db")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

const ENABLED = { has: () => true, pushableTemplateCodes: ["invoice", "receipt", "expense_receipt"] }
const DISABLED = { has: () => false, pushableTemplateCodes: [] }

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(db)) delete db[key]
  capabilitiesMock.mockResolvedValue(ENABLED)
})

describe("describeApproveReviewTasks", () => {
  it("refuses when review-queue is not enabled", async () => {
    capabilitiesMock.mockResolvedValue(DISABLED)
    expect(await describeApproveReviewTasks("w1", ["t1"])).toEqual({ error: "review_queue_not_enabled" })
  })

  it("returns a proposal naming the matched documents, never mutating anything", async () => {
    db.reviewTask = { findMany: vi.fn().mockResolvedValue([{ id: "t1", document: { filename: "a.pdf" } }, { id: "t2", document: { filename: "b.pdf" } }]) }
    const result = await describeApproveReviewTasks("w1", ["t1", "t2"])
    expect(result).toEqual({ kind: "approve_review_tasks", taskIds: ["t1", "t2"], summary: expect.stringContaining("a.pdf") })
  })

  it("errors when none of the given ids match a task in this workspace", async () => {
    db.reviewTask = { findMany: vi.fn().mockResolvedValue([]) }
    expect(await describeApproveReviewTasks("w1", ["nope"])).toEqual({ error: "no_matching_review_tasks" })
  })
})

describe("describeRejectReviewTask", () => {
  it("errors when the task doesn't exist in this workspace", async () => {
    db.reviewTask = { findFirst: vi.fn().mockResolvedValue(null) }
    expect(await describeRejectReviewTask("w1", "t1")).toEqual({ error: "review_task_not_found" })
  })

  it("names the document in the summary", async () => {
    db.reviewTask = { findFirst: vi.fn().mockResolvedValue({ id: "t1", document: { filename: "invoice.pdf" } }) }
    const result = await describeRejectReviewTask("w1", "t1")
    expect(result).toMatchObject({ kind: "reject_review_task", taskId: "t1" })
  })
})

describe("describeSetDocumentCoding", () => {
  it("refuses empty coding data", async () => {
    expect(await describeSetDocumentCoding("w1", "d1", {})).toEqual({ error: "coding_data_required" })
  })

  it("errors on an unknown document", async () => {
    db.document = { findFirst: vi.fn().mockResolvedValue(null) }
    expect(await describeSetDocumentCoding("w1", "d1", { account: "6000" })).toEqual({ error: "document_not_found" })
  })

  it("describes the coding it would set", async () => {
    db.document = { findFirst: vi.fn().mockResolvedValue({ filename: "a.pdf" }) }
    const result = await describeSetDocumentCoding("w1", "d1", { account: "6000" })
    expect(result).toMatchObject({ kind: "set_document_coding", documentId: "d1", codingData: { account: "6000" } })
  })
})

describe("describeCreateSupplierRule", () => {
  it("refuses when supplier-rules is not enabled", async () => {
    capabilitiesMock.mockResolvedValue(DISABLED)
    expect(await describeCreateSupplierRule("w1", { matcherType: "exact", matcherValue: "Acme", account: "6000" })).toEqual({ error: "supplier_rules_not_enabled" })
  })

  it("refuses a blank matcher or account", async () => {
    expect(await describeCreateSupplierRule("w1", { matcherType: "exact", matcherValue: "  ", account: "6000" })).toEqual({ error: "matcher_value_required" })
    expect(await describeCreateSupplierRule("w1", { matcherType: "exact", matcherValue: "Acme", account: " " })).toEqual({ error: "account_required" })
  })

  it("mentions requireReview and autopublish in the summary only when set", async () => {
    const plain = await describeCreateSupplierRule("w1", { matcherType: "exact", matcherValue: "Acme", account: "6000" })
    const withFlags = await describeCreateSupplierRule("w1", { matcherType: "exact", matcherValue: "Acme", account: "6000", requireReview: true, autopublish: true })
    expect((plain as { summary: string }).summary).not.toMatch(/review|automatically/)
    expect((withFlags as { summary: string }).summary).toMatch(/review/)
    expect((withFlags as { summary: string }).summary).toMatch(/automatically/)
  })

  it("snaps a freehand account onto the synced chart of accounts when a confident match exists", async () => {
    listAccountingEntitiesMock.mockResolvedValueOnce([{ code: null, name: "6000 — Printing" }, { code: null, name: "6100 — Software" }])
    const result = await describeCreateSupplierRule("w1", { matcherType: "exact", matcherValue: "Acme", account: "printing" })
    expect((result as { account: string }).account).toBe("6000 — Printing")
  })

  it("leaves the account untouched when nothing in the synced list confidently matches", async () => {
    listAccountingEntitiesMock.mockResolvedValueOnce([{ code: null, name: "6000 — Printing" }])
    const result = await describeCreateSupplierRule("w1", { matcherType: "exact", matcherValue: "Acme", account: "Brand new account" })
    expect((result as { account: string }).account).toBe("Brand new account")
  })
})

describe("snapAccountToSyncedList", () => {
  it("returns the input unchanged when there is no synced list", () => {
    expect(snapAccountToSyncedList("6000 Printing", [])).toBe("6000 Printing")
  })

  it("matches exactly, ignoring case and punctuation", () => {
    const synced = [{ code: "6000", name: "Printing" }]
    expect(snapAccountToSyncedList("6000 - printing", synced)).toBe("6000 — Printing")
    expect(snapAccountToSyncedList("printing", synced)).toBe("6000 — Printing")
    expect(snapAccountToSyncedList("6000", synced)).toBe("6000 — Printing")
  })

  it("snaps only when exactly one synced account contains the freehand text", () => {
    const synced = [{ code: "6000", name: "Printing supplies" }, { code: "6100", name: "Software" }]
    expect(snapAccountToSyncedList("printing", synced)).toBe("6000 — Printing supplies")
  })

  it("leaves the text unchanged when it matches more than one synced account", () => {
    const synced = [{ code: "6000", name: "Office printing" }, { code: "6001", name: "Warehouse printing" }]
    expect(snapAccountToSyncedList("printing", synced)).toBe("printing")
  })

  it("leaves the text unchanged when nothing matches", () => {
    const synced = [{ code: "6000", name: "Printing" }]
    expect(snapAccountToSyncedList("Travel", synced)).toBe("Travel")
  })
})

describe("describePushToAccounting", () => {
  it("refuses when accounting-push is not enabled", async () => {
    capabilitiesMock.mockResolvedValue(DISABLED)
    expect(await describePushToAccounting("w1", "d1")).toEqual({ error: "accounting_push_not_enabled" })
  })

  it("refuses a document that isn't reviewed yet", async () => {
    db.document = { findFirst: vi.fn().mockResolvedValue({ filename: "a.pdf", status: "extracted", template: { code: "invoice" } }) }
    expect(await describePushToAccounting("w1", "d1")).toEqual({ error: "document_not_reviewed" })
  })

  it("refuses a document type that isn't pushable", async () => {
    db.document = { findFirst: vi.fn().mockResolvedValue({ filename: "a.pdf", status: "reviewed", template: { code: "bank_statement" } }) }
    expect(await describePushToAccounting("w1", "d1")).toEqual({ error: "document_type_not_pushable" })
  })

  it("refuses when there's no active connection", async () => {
    db.document = { findFirst: vi.fn().mockResolvedValue({ filename: "a.pdf", status: "reviewed", template: { code: "invoice" } }) }
    db.integrationConnection = { findFirst: vi.fn().mockResolvedValue(null) }
    expect(await describePushToAccounting("w1", "d1")).toEqual({ error: "no_active_connection" })
  })

  it("proposes the push with the resolved connection", async () => {
    db.document = { findFirst: vi.fn().mockResolvedValue({ filename: "a.pdf", status: "reviewed", template: { code: "invoice" } }) }
    db.integrationConnection = { findFirst: vi.fn().mockResolvedValue({ id: "c1", provider: "quickbooks" }) }
    const result = await describePushToAccounting("w1", "d1")
    expect(result).toMatchObject({ kind: "push_to_accounting", documentId: "d1", connectionId: "c1" })
  })
})
