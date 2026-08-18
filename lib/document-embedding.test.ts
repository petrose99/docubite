import { beforeEach, describe, expect, it, vi } from "vitest"

const embeddings = { enabled: true, baseUrl: "https://emb.test", apiKey: "", modelName: "m", dimensions: 3, batchSize: 32, timeoutMs: 5_000 }
vi.mock("@/lib/config", () => ({ default: { embeddings } }))

const prisma = {
  documentProcessingJob: { update: vi.fn() },
  documentAuditEvent: { create: vi.fn(() => ({})) },
  document: { update: vi.fn() },
  $transaction: vi.fn(async (ops: unknown) => (typeof ops === "function" ? (ops as (tx: unknown) => unknown)(prisma) : Promise.all(ops as unknown[]))),
}
vi.mock("@/lib/db", () => ({ prisma }))
vi.mock("@/lib/document-storage", () => ({ readDocumentBlocks: vi.fn(), documentBlocksKey: (ws: string, id: string) => `workspaces/${ws}/documents/${id}/blocks` }))
vi.mock("@/lib/embeddings", () => ({ embedTexts: vi.fn() }))
vi.mock("@/models/document-chunks", () => ({ getDocumentChunkHashes: vi.fn(), replaceDocumentChunks: vi.fn(), deleteDocumentChunks: vi.fn() }))

const { processEmbedJob } = await import("@/lib/document-embedding")
const { readDocumentBlocks } = await import("@/lib/document-storage")
const { embedTexts } = await import("@/lib/embeddings")
const { getDocumentChunkHashes, replaceDocumentChunks, deleteDocumentChunks } = await import("@/models/document-chunks")

function job(overrides: Partial<{ attempts: number; ocrText: string; aiEnabled: boolean }> = {}) {
  return {
    id: "job1",
    attempts: overrides.attempts ?? 1,
    scheduledAt: new Date(0),
    document: {
      id: "doc1",
      workspaceId: "ws1",
      fileId: "file1",
      ocrText: overrides.ocrText ?? "First paragraph here.\n\nSecond paragraph here.",
      workspace: { aiEnabled: overrides.aiEnabled ?? true },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  embeddings.enabled = true
  vi.mocked(readDocumentBlocks).mockResolvedValue(null)
  vi.mocked(getDocumentChunkHashes).mockResolvedValue([])
  vi.mocked(embedTexts).mockImplementation(async (inputs: string[]) => inputs.map(() => [0, 0, 0]))
})

describe("processEmbedJob happy paths", () => {
  it("chunks from ocrText when there is no sidecar, embeds, and stores", async () => {
    await processEmbedJob(job())
    expect(embedTexts).toHaveBeenCalled()
    expect(replaceDocumentChunks).toHaveBeenCalledTimes(1)
    expect(vi.mocked(replaceDocumentChunks).mock.calls[0][0]).toMatchObject({ workspaceId: "ws1", documentId: "doc1", fileId: "file1" })
    expect(prisma.documentProcessingJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }))
  })

  it("completes as a no-op with zero-text, clearing stale chunks and calling no endpoint", async () => {
    await processEmbedJob(job({ ocrText: "" }))
    expect(embedTexts).not.toHaveBeenCalled()
    expect(replaceDocumentChunks).not.toHaveBeenCalled()
    expect(deleteDocumentChunks).toHaveBeenCalledWith("ws1", "doc1")
    expect(prisma.documentProcessingJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }))
  })

  it("skips the endpoint entirely when stored hashes already match", async () => {
    const ocrText = "First paragraph here.\n\nSecond paragraph here."
    // Compute the hashes chunkFromText would produce so getDocumentChunkHashes returns an exact match.
    const { chunkFromText } = await import("@/lib/chunking")
    const expected = chunkFromText(ocrText, "m").map((chunk) => chunk.contentHash)
    vi.mocked(getDocumentChunkHashes).mockResolvedValue(expected)

    await processEmbedJob(job({ ocrText }))
    expect(embedTexts).not.toHaveBeenCalled()
    expect(replaceDocumentChunks).not.toHaveBeenCalled()
    expect(prisma.documentProcessingJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }))
  })

  it("completes as a no-op when the workspace has AI disabled", async () => {
    await processEmbedJob(job({ aiEnabled: false }))
    expect(embedTexts).not.toHaveBeenCalled()
    expect(replaceDocumentChunks).not.toHaveBeenCalled()
    expect(prisma.documentProcessingJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "completed" }) }))
  })
})

describe("processEmbedJob failure handling", () => {
  it("fails permanently on a misconfiguration and never touches document.status", async () => {
    embeddings.enabled = false
    await expect(processEmbedJob(job())).rejects.toThrow()
    expect(prisma.documentProcessingJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed", errorCode: "embeddings_not_configured" }) }))
    expect(prisma.document.update).not.toHaveBeenCalled()
  })

  it("re-queues a transient failure and never touches document.status", async () => {
    vi.mocked(embedTexts).mockRejectedValue(new Error("embeddings_http_503"))
    await expect(processEmbedJob(job({ attempts: 1 }))).rejects.toThrow()
    expect(prisma.documentProcessingJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "queued", errorCode: "embeddings_http_503" }) }))
    expect(prisma.document.update).not.toHaveBeenCalled()
  })

  it("fails permanently after 5 attempts even for a transient code", async () => {
    vi.mocked(embedTexts).mockRejectedValue(new Error("embeddings_http_503"))
    await expect(processEmbedJob(job({ attempts: 5 }))).rejects.toThrow()
    expect(prisma.documentProcessingJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) }))
  })
})
