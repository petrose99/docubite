import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/prisma/client", () => ({ Prisma: {} }))

const { saveWorkbook, StaleRevisionError } = await import("@/models/spreadsheets")
const { prisma } = await import("@/lib/db")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

const input = { workspaceId: "ws", fileId: "file", snapshot: { id: "file", sheets: {} } }

beforeEach(() => {
  vi.clearAllMocks()
  db.spreadsheetWorkbook = {
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  }
})

describe("saveWorkbook", () => {
  it("creates the workbook at revision 1 when the file has never been opened in the grid", async () => {
    db.spreadsheetWorkbook.findUnique.mockResolvedValue(null)
    db.spreadsheetWorkbook.create.mockResolvedValue({ rev: 1, snapshot: input.snapshot, updatedAt: new Date(0) })

    const saved = await saveWorkbook({ ...input, rev: 0 })

    expect(saved.rev).toBe(1)
    expect(db.spreadsheetWorkbook.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ fileId: "file", rev: 1 }) }))
    expect(db.spreadsheetWorkbook.updateMany).not.toHaveBeenCalled()
  })

  it("guards the revision inside the update so two saves racing on one revision cannot both win", async () => {
    db.spreadsheetWorkbook.findUnique.mockResolvedValue({ rev: 4 })
    db.spreadsheetWorkbook.updateMany.mockResolvedValue({ count: 1 })
    db.spreadsheetWorkbook.findUniqueOrThrow.mockResolvedValue({ rev: 5, snapshot: input.snapshot, updatedAt: new Date(0) })

    const saved = await saveWorkbook({ ...input, rev: 4 })

    expect(saved.rev).toBe(5)
    expect(db.spreadsheetWorkbook.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { fileId: "file", rev: 4 } }))
  })

  it("rejects a save from a tab that loaded an older revision, reporting the current one", async () => {
    db.spreadsheetWorkbook.findUnique.mockResolvedValue({ rev: 9 })
    db.spreadsheetWorkbook.updateMany.mockResolvedValue({ count: 0 })

    await expect(saveWorkbook({ ...input, rev: 4 })).rejects.toThrow(StaleRevisionError)
    await expect(saveWorkbook({ ...input, rev: 4 }).catch((error) => (error as InstanceType<typeof StaleRevisionError>).currentRev)).resolves.toBe(9)
    expect(db.spreadsheetWorkbook.findUniqueOrThrow).not.toHaveBeenCalled()
  })
})
