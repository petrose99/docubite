import { beforeEach, describe, expect, it, vi } from "vitest"

class FakePrismaClientKnownRequestError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
  }
}

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/prisma/client", () => ({ Prisma: { PrismaClientKnownRequestError: FakePrismaClientKnownRequestError } }))

const { saveWorkbook, StaleRevisionError } = await import("@/models/spreadsheets")
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

  it("recovers when a concurrent request already created the workbook (P2002 on file_id)", async () => {
    db.spreadsheetWorkbook.findFirst.mockResolvedValue(null)
    db.spreadsheetWorkbook.create.mockRejectedValue(new FakePrismaClientKnownRequestError("Unique constraint failed on the fields: (`file_id`)", "P2002"))
    db.spreadsheetWorkbook.findFirstOrThrow.mockResolvedValue({ rev: 1, snapshot: input.snapshot, updatedAt: new Date(0) })

    const saved = await saveWorkbook({ ...input, rev: 0 })

    expect(saved.rev).toBe(1)
    expect(db.spreadsheetWorkbook.findFirstOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "ws", fileId: "file" } }))
  })

  it("re-throws create errors that are not the unique-constraint race", async () => {
    db.spreadsheetWorkbook.findFirst.mockResolvedValue(null)
    db.spreadsheetWorkbook.create.mockRejectedValue(new FakePrismaClientKnownRequestError("connection lost", "P1001"))

    await expect(saveWorkbook({ ...input, rev: 0 })).rejects.toThrow("connection lost")
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
