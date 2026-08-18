import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: { document: { findMany: vi.fn() } } }))
vi.mock("@/lib/embeddings", () => ({ embedTexts: vi.fn() }))
vi.mock("@/models/document-chunks", () => ({ vectorSearch: vi.fn(), lexicalSearch: vi.fn() }))

const { rrfFuse, searchDocumentChunks } = await import("@/lib/retrieval")
const { prisma } = await import("@/lib/db")
const { embedTexts } = await import("@/lib/embeddings")
const { vectorSearch, lexicalSearch } = await import("@/models/document-chunks")

function hit(id: string, documentId = "doc1", text = "snippet", page: number | null = 1) {
  return { id, documentId, chunkIndex: 0, text, provenance: page === null ? null : { pages: [page] }, score: 0.5 }
}

describe("rrfFuse", () => {
  it("sums reciprocal ranks, dedupes by id, and ranks by fused score", () => {
    const listA = [{ id: "a" }, { id: "b" }]
    const listB = [{ id: "b" }, { id: "c" }]
    const fused = rrfFuse([listA, listB])
    expect(fused.map((item) => item.id)).toEqual(["b", "a", "c"])
    // b appears in both lists, so it is deduped to a single, top-scoring entry.
    expect(fused.filter((item) => item.id === "b")).toHaveLength(1)
  })

  it("breaks score ties by first-seen order (stable)", () => {
    const fused = rrfFuse([[{ id: "a" }], [{ id: "x" }]])
    expect(fused.map((item) => item.id)).toEqual(["a", "x"])
    expect(fused[0].score).toBeCloseTo(fused[1].score)
  })
})

describe("searchDocumentChunks", () => {
  beforeEach(() => {
    vi.mocked(prisma.document.findMany).mockReset()
    vi.mocked(embedTexts).mockReset()
    vi.mocked(vectorSearch).mockReset()
    vi.mocked(lexicalSearch).mockReset()
    vi.mocked(prisma.document.findMany).mockResolvedValue([{ id: "doc1", filename: "invoice.pdf" }] as never)
  })

  it("degrades to lexical-only when the embedding endpoint is down", async () => {
    vi.mocked(embedTexts).mockRejectedValue(new Error("embeddings_request_failed"))
    vi.mocked(lexicalSearch).mockResolvedValue([hit("c1")] as never)

    const results = await searchDocumentChunks("ws1", "invoice 42")

    expect(vectorSearch).not.toHaveBeenCalled()
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ documentId: "doc1", filename: "invoice.pdf", page: 1 })
  })

  it("fuses vector and lexical hits and hydrates filenames", async () => {
    vi.mocked(embedTexts).mockResolvedValue([[0.1, 0.2, 0.3]] as never)
    vi.mocked(vectorSearch).mockResolvedValue([hit("c1")] as never)
    vi.mocked(lexicalSearch).mockResolvedValue([hit("c2")] as never)

    const results = await searchDocumentChunks("ws1", "invoice 42")

    expect(results.map((result) => result.filename)).toEqual(["invoice.pdf", "invoice.pdf"])
    // Filenames are hydrated with exactly one workspace-scoped query.
    expect(prisma.document.findMany).toHaveBeenCalledTimes(1)
    expect(vi.mocked(prisma.document.findMany).mock.calls[0][0]).toMatchObject({ where: { workspaceId: "ws1" } })
  })

  it("drops a hit whose document is not in the workspace", async () => {
    vi.mocked(embedTexts).mockResolvedValue([[0.1, 0.2, 0.3]] as never)
    vi.mocked(vectorSearch).mockResolvedValue([hit("c1", "foreign-doc")] as never)
    vi.mocked(lexicalSearch).mockResolvedValue([] as never)

    const results = await searchDocumentChunks("ws1", "invoice 42")
    expect(results).toEqual([])
  })
})
