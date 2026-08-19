import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/prisma/client", () => ({ Prisma: {}, PrismaClient: vi.fn() }))
vi.mock("@/models/workspaces", () => ({ consumeWorkspaceQuota: vi.fn() }))
vi.mock("@/lib/document-storage", () => ({ documentStorageKey: vi.fn(), documentBlocksKey: vi.fn((ws: string, id: string) => `workspaces/${ws}/documents/${id}/blocks`), putDocumentSource: vi.fn(), deleteDocumentSource: vi.fn() }))

const { createDocumentFromBuffer, deleteWorkspaceDocuments, documentDataForExport, documentHash, documentSourceFor, isSupportedDocumentBuffer, validateDocumentInput } = await import("@/models/documents")
const { prisma } = await import("@/lib/db")
const { deleteDocumentSource } = await import("@/lib/document-storage")

describe("documentSourceFor", () => {
  // Regression: dictations were being stored with source "upload" (the value every caller passes),
  // so Document.source was never "dictation", so their chunks were tagged vlm_ocr — a dictated
  // snippet was cited as though it had been read off a printed page.
  it("records any audio upload as a dictation, whatever the caller passed", () => {
    for (const mime of ["audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/flac"]) {
      expect(documentSourceFor(mime, "upload")).toBe("dictation")
    }
  })

  it("leaves every non-audio type on the caller's source", () => {
    for (const mime of ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]) {
      expect(documentSourceFor(mime, "upload")).toBe("upload")
    }
  })
})

describe("document input validation", () => {
  it("requires matching MIME magic bytes", () => {
    const pdf = Buffer.from("%PDF-1.7\n")
    expect(isSupportedDocumentBuffer(pdf, "application/pdf")).toBe(true)
    expect(isSupportedDocumentBuffer(Buffer.from("not a PDF"), "application/pdf")).toBe(false)
    expect(() => validateDocumentInput(Buffer.from("not a PDF"), "application/pdf")).toThrow("unsupported_document_type")
  })

  it("accepts PNG signatures only for PNG uploads", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    expect(isSupportedDocumentBuffer(png, "image/png")).toBe(true)
    expect(isSupportedDocumentBuffer(png, "image/jpeg")).toBe(false)
  })

  it("accepts JPEG signatures", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])
    expect(isSupportedDocumentBuffer(jpeg, "image/jpeg")).toBe(true)
    expect(isSupportedDocumentBuffer(jpeg, "image/png")).toBe(false)
  })

  it("accepts WebP signatures", () => {
    const webp = Buffer.alloc(16)
    webp.write("RIFF", 0)
    webp.write("WEBP", 8)
    expect(isSupportedDocumentBuffer(webp, "image/webp")).toBe(true)
    expect(isSupportedDocumentBuffer(webp, "application/pdf")).toBe(false)
  })

  it("accepts HEIC via ftyp box", () => {
    const heic = Buffer.alloc(16)
    heic.write("ftyp", 4)
    expect(isSupportedDocumentBuffer(heic, "image/heic")).toBe(true)
  })

  it("rejects unsupported MIME types regardless of content", () => {
    const pdf = Buffer.from("%PDF-1.7\n")
    expect(isSupportedDocumentBuffer(pdf, "text/plain")).toBe(false)
    expect(isSupportedDocumentBuffer(pdf, "application/zip")).toBe(false)
  })

  it("rejects empty buffers", () => {
    expect(() => validateDocumentInput(Buffer.alloc(0), "application/pdf")).toThrow("invalid_document_size")
  })

  it("rejects buffers exceeding size limit", () => {
    const oversized = Buffer.alloc(51 * 1024 * 1024)
    oversized.write("%PDF-")
    expect(() => validateDocumentInput(oversized, "application/pdf")).toThrow("invalid_document_size")
  })
})

/** The file layer moved dedup from (workspaceId, sha256) to (fileId, sha256), so the same PDF
 * can be extracted into two different files with two different column sets. These lock in that
 * the lookup is keyed on the file — a regression here would silently return the *other* file's
 * document as a duplicate instead of extracting into this one. */
describe("createDocumentFromBuffer deduplication", () => {
  const db = prisma as unknown as Record<string, never>
  const pdf = Buffer.from("%PDF-1.7\nhello")
  let findUnique: ReturnType<typeof vi.fn>
  let templateFindFirst: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    findUnique = vi.fn().mockResolvedValue(null)
    templateFindFirst = vi.fn().mockResolvedValue({ id: "tpl-1", versions: [{ id: "ver-1", fields: [] }] })
    Object.assign(db, {
      documentTemplate: { findFirst: templateFindFirst },
      document: { findUnique, create: vi.fn(async ({ data }: { data: unknown }) => data) },
      documentProcessingJob: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "job-1" }) },
      documentAuditEvent: { create: vi.fn() },
      $transaction: vi.fn(async (run: (tx: unknown) => unknown) => run(db)),
    })
  })

  const input = { workspaceId: "w", fileId: "file-a", templateId: "tpl-1", source: "upload" as const, filename: "invoice.pdf", mimeType: "application/pdf", buffer: pdf }

  it("looks the existing document up by file, not by workspace", async () => {
    await createDocumentFromBuffer(input)
    expect(findUnique).toHaveBeenCalledWith({ where: { fileId_sha256: { fileId: "file-a", sha256: documentHash(pdf) } } })
  })

  it("treats the same bytes in a different file as a fresh document", async () => {
    findUnique.mockImplementation(async ({ where }: { where: { fileId_sha256: { fileId: string } } }) =>
      (where.fileId_sha256.fileId === "file-a" ? { id: "doc-1" } : null))

    await expect(createDocumentFromBuffer(input)).resolves.toMatchObject({ duplicate: true })
    await expect(createDocumentFromBuffer({ ...input, fileId: "file-b" })).resolves.toMatchObject({ duplicate: false })
  })

  it("refuses a template that belongs to another file", async () => {
    templateFindFirst.mockResolvedValue(null)
    await expect(createDocumentFromBuffer(input)).rejects.toThrow("document_template_not_found")
    expect(templateFindFirst.mock.calls[0][0].where).toMatchObject({ id: "tpl-1", workspaceId: "w", fileId: "file-a" })
  })
})

describe("deleteWorkspaceDocuments", () => {
  const db = prisma as unknown as Record<string, never>
  let findMany: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(deleteDocumentSource).mockResolvedValue(undefined)
    findMany = vi.fn()
    Object.assign(db, {
      document: { findMany, delete: vi.fn() },
      documentAuditEvent: { create: vi.fn() },
      $transaction: vi.fn(async (operations: unknown[]) => operations),
    })
  })

  it("removes the stored source and the row, and audits the deletion", async () => {
    findMany.mockResolvedValue([{ id: "doc-1", storageKey: "workspaces/w/documents/doc-1/source" }])

    await expect(deleteWorkspaceDocuments("w", ["doc-1"], "user-1")).resolves.toEqual({ deleted: 1 })
    expect(deleteDocumentSource).toHaveBeenCalledWith("workspaces/w/documents/doc-1/source")
    expect(db.documentAuditEvent.create).toHaveBeenCalledWith({ data: { workspaceId: "w", actorId: "user-1", type: "document_deleted" } })
  })

  it("still deletes the row when the stored file is already gone", async () => {
    findMany.mockResolvedValue([{ id: "doc-1", storageKey: "missing/source" }])
    vi.mocked(deleteDocumentSource).mockRejectedValueOnce(new Error("ENOENT"))

    await expect(deleteWorkspaceDocuments("w", ["doc-1"], "user-1")).resolves.toEqual({ deleted: 1 })
    expect(db.document.delete).toHaveBeenCalledWith({ where: { id: "doc-1" } })
  })

  it("skips the source but still clears the blocks sidecar when there is no stored source", async () => {
    findMany.mockResolvedValue([{ id: "doc-1", storageKey: null }])

    await expect(deleteWorkspaceDocuments("w", ["doc-1"], "user-1")).resolves.toEqual({ deleted: 1 })
    // No source to delete, but the sidecar under the same prefix is cleared unconditionally.
    expect(deleteDocumentSource).toHaveBeenCalledTimes(1)
    expect(deleteDocumentSource).toHaveBeenCalledWith("workspaces/w/documents/doc-1/blocks")
  })

  it("caps a single call at 100 documents", async () => {
    findMany.mockResolvedValue([])
    const ids = Array.from({ length: 150 }, (_, index) => `doc-${index}`)

    await deleteWorkspaceDocuments("w", ids, "user-1")
    expect(findMany.mock.calls[0][0].where.id.in).toHaveLength(100)
  })
})

describe("document hashing", () => {
  it("produces consistent SHA-256 hex digests", () => {
    const hash = documentHash(Buffer.from("hello"))
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(documentHash(Buffer.from("hello"))).toBe(hash)
    expect(documentHash(Buffer.from("world"))).not.toBe(hash)
  })
})

describe("documentDataForExport", () => {
  it("flattens reviewed data into the export row", () => {
    const row = documentDataForExport({
      filename: "invoice.pdf",
      status: "reviewed",
      receivedAt: new Date("2026-08-01T00:00:00Z"),
      reviewedData: { vendor: "Acme", total: 100 },
    })
    expect(row).toEqual({
      filename: "invoice.pdf",
      status: "reviewed",
      received_at: "2026-08-01T00:00:00.000Z",
      vendor: "Acme",
      total: 100,
    })
  })

  it("handles null reviewedData", () => {
    const row = documentDataForExport({
      filename: "doc.pdf",
      status: "queued",
      receivedAt: new Date("2026-08-01T00:00:00Z"),
      reviewedData: null as unknown as Record<string, unknown>,
    })
    expect(row.filename).toBe("doc.pdf")
  })
})
