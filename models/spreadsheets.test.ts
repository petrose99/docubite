import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/prisma/client", () => ({ Prisma: {} }))

const { saveWorkbook, ensureFileWorkbook, StaleRevisionError } = await import("@/models/spreadsheets")
const { prisma } = await import("@/lib/db")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

const input = { workspaceId: "ws", fileId: "file", snapshot: { id: "file", sheets: {} } }

beforeEach(() => {
  vi.clearAllMocks()
  db.spreadsheetWorkbook = {
    findFirst: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    findFirstOrThrow: vi.fn(),
  }
})

describe("saveWorkbook", () => {
  it("creates the workbook at revision 1 when the file has never been opened in the grid", async () => {
    db.spreadsheetWorkbook.findFirst.mockResolvedValue(null)
    db.spreadsheetWorkbook.create.mockResolvedValue({ rev: 1, snapshot: input.snapshot, updatedAt: new Date(0) })

    const saved = await saveWorkbook({ ...input, rev: 0 })

    expect(saved.rev).toBe(1)
    expect(db.spreadsheetWorkbook.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ fileId: "file", rev: 1 }) }))
    expect(db.spreadsheetWorkbook.updateMany).not.toHaveBeenCalled()
  })

  it("guards the revision inside the update so two saves racing on one revision cannot both win", async () => {
    db.spreadsheetWorkbook.findFirst.mockResolvedValue({ rev: 4 })
    db.spreadsheetWorkbook.updateMany.mockResolvedValue({ count: 1 })
    db.spreadsheetWorkbook.findFirstOrThrow.mockResolvedValue({ rev: 5, snapshot: input.snapshot, updatedAt: new Date(0) })

    const saved = await saveWorkbook({ ...input, rev: 4 })

    expect(saved.rev).toBe(5)
    expect(db.spreadsheetWorkbook.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "ws", fileId: "file", rev: 4 } }))
  })

  it("rejects a save from a tab that loaded an older revision, reporting the current one", async () => {
    db.spreadsheetWorkbook.findFirst.mockResolvedValue({ rev: 9 })
    db.spreadsheetWorkbook.updateMany.mockResolvedValue({ count: 0 })

    await expect(saveWorkbook({ ...input, rev: 4 })).rejects.toThrow(StaleRevisionError)
    await expect(saveWorkbook({ ...input, rev: 4 }).catch((error) => (error as InstanceType<typeof StaleRevisionError>).currentRev)).resolves.toBe(9)
    expect(db.spreadsheetWorkbook.findFirstOrThrow).not.toHaveBeenCalled()
  })
})

describe("ensureFileWorkbook", () => {
  beforeEach(() => {
    db.documentTemplate = { findMany: vi.fn(), update: vi.fn() }
    db.document = { findMany: vi.fn(), updateMany: vi.fn() }
  })

  // Uploading now happens from Home/Files or a file's own hub, never from the sheet — so a
  // document can finish extracting while its file's sheet has NEVER been opened. This is the
  // reconcile path that makes that safe: the first-ever load must still seed every ready
  // document into the grid, not just the ones that happened to arrive while someone was watching.
  it("seeds every ready document on the first-ever load, even though nothing was watching while they processed", async () => {
    db.documentTemplate.findMany.mockResolvedValue([
      { id: "tpl1", univerSheetId: null, name: "Sheet 1", multiRow: false, versions: [{ fields: [] }] },
    ])
    db.spreadsheetWorkbook.findFirst.mockResolvedValue(null) // no workbook yet: never opened
    db.document.findMany.mockResolvedValue([
      { id: "doc1", filename: "invoice.pdf", templateId: "tpl1", reviewedData: {}, rawExtraction: null, confidence: null },
    ])
    db.spreadsheetWorkbook.create.mockResolvedValue({ rev: 1, snapshot: { id: "file", sheets: {} }, updatedAt: new Date(0) })

    const result = await ensureFileWorkbook("ws", "file")

    expect(result?.rev).toBe(1)
    expect(db.document.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workspaceId: "ws", fileId: "file", status: { notIn: ["received", "queued", "processing", "failed"] } }),
    }))
    // First-ever load takes every finished document — no `sheetAppliedAt: null` filter, since
    // there is no existing workbook yet for anything to have been applied to.
    expect(db.document.findMany.mock.calls[0][0].where.sheetAppliedAt).toBeUndefined()
    expect(db.document.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["doc1"] } } }))
  })
})
