import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/lib/malware-scan", () => ({ scanDocumentBuffer: vi.fn() }))
vi.mock("@/models/documents", () => ({
  createDocumentFromBuffer: vi.fn(),
  documentHash: (buffer: Buffer) => `hash:${buffer.toString()}`,
}))

const { createIngestionItem } = await import("@/lib/ingestion")
const { prisma } = await import("@/lib/db")
const { scanDocumentBuffer } = await import("@/lib/malware-scan")
const { createDocumentFromBuffer } = await import("@/models/documents")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

const input = { workspaceId: "w1", fileId: "f1", templateId: "t1", source: "upload" as const, filename: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("hello") }

beforeEach(() => {
  vi.clearAllMocks()
  db.ingestionItem = { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn() }
  vi.mocked(scanDocumentBuffer).mockResolvedValue(undefined)
})

describe("createIngestionItem", () => {
  it("short-circuits as duplicate when a prior successful ingestion has the same bytes", async () => {
    db.ingestionItem.findUnique.mockResolvedValue({ id: "i1", documentId: "d1", workspaceId: "w1" })
    const result = await createIngestionItem(input)
    expect(result.outcome).toBe("duplicate")
    expect(scanDocumentBuffer).not.toHaveBeenCalled()
    expect(db.ingestionItem.upsert).not.toHaveBeenCalled()
  })

  it("does not short-circuit a prior attempt that never produced a document", async () => {
    db.ingestionItem.findUnique.mockResolvedValue({ id: "i1", documentId: null, workspaceId: "w1", status: "rejected" })
    vi.mocked(createDocumentFromBuffer).mockResolvedValue({ document: { id: "d2", filename: "invoice.pdf" }, job: { id: "j1" }, duplicate: false } as never)
    db.ingestionItem.upsert.mockResolvedValue({ id: "i1", documentId: "d2" })

    const result = await createIngestionItem(input)

    expect(result.outcome).toBe("accepted")
    expect(scanDocumentBuffer).toHaveBeenCalled()
  })

  it("records a rejection when the malware scan refuses the file, without calling createDocumentFromBuffer", async () => {
    vi.mocked(scanDocumentBuffer).mockRejectedValue(new Error("malware_detected"))
    db.ingestionItem.upsert.mockResolvedValue({ id: "i1", status: "rejected", errorCode: "malware_detected" })

    const result = await createIngestionItem(input)

    expect(result.outcome).toBe("rejected")
    if (result.outcome === "rejected") expect(result.errorCode).toBe("malware_detected")
    expect(createDocumentFromBuffer).not.toHaveBeenCalled()
    expect(db.ingestionItem.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ malwareStatus: "infected", status: "rejected" }),
    }))
  })

  it("marks a scanner outage as scan_failed rather than infected", async () => {
    vi.mocked(scanDocumentBuffer).mockRejectedValue(new Error("malware_scanner_unavailable"))
    db.ingestionItem.upsert.mockResolvedValue({ id: "i1" })
    await createIngestionItem(input)
    expect(db.ingestionItem.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ malwareStatus: "scan_failed" }),
    }))
  })

  it("records a failure when createDocumentFromBuffer itself throws", async () => {
    vi.mocked(createDocumentFromBuffer).mockRejectedValue(new Error("document_quota_exhausted"))
    db.ingestionItem.upsert.mockResolvedValue({ id: "i1", status: "failed", errorCode: "document_quota_exhausted" })

    const result = await createIngestionItem(input)

    expect(result.outcome).toBe("rejected")
    expect(db.ingestionItem.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: "failed", errorCode: "document_quota_exhausted" }),
    }))
  })

  it("maps every non-upload/dictation source to \"upload\" for the underlying Document row", async () => {
    vi.mocked(createDocumentFromBuffer).mockResolvedValue({ document: { id: "d3", filename: "invoice.pdf" }, job: null, duplicate: false } as never)
    db.ingestionItem.upsert.mockResolvedValue({ id: "i1", documentId: "d3" })

    await createIngestionItem({ ...input, source: "zip" })

    expect(vi.mocked(createDocumentFromBuffer).mock.calls[0][0].source).toBe("upload")
  })

  it("records success as \"extracting\", or \"duplicate\" when the file already exists in this file", async () => {
    vi.mocked(createDocumentFromBuffer).mockResolvedValue({ document: { id: "d4", filename: "invoice.pdf" }, job: null, duplicate: true } as never)
    db.ingestionItem.upsert.mockResolvedValue({ id: "i1", documentId: "d4", status: "duplicate" })

    const result = await createIngestionItem(input)

    expect(result.outcome).toBe("accepted")
    if (result.outcome === "accepted") expect(result.duplicateInFile).toBe(true)
    expect(db.ingestionItem.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: "duplicate" }),
    }))
  })
})
