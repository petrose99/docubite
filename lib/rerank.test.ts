import { beforeEach, describe, expect, it, vi } from "vitest"

const retrieval = { routerEnabled: false, rerankEnabled: false, rerankBaseUrl: "https://rerank.test", rerankApiKey: "k", rerankModelName: "m", rerankTimeoutMs: 5000 }
vi.mock("@/lib/config", () => ({ default: { get retrieval() { return retrieval } } }))

const { rerank } = await import("@/lib/rerank")

const hits = [
  { id: "a", text: "alpha" },
  { id: "b", text: "bravo" },
  { id: "c", text: "charlie" },
]

const fetchMock = vi.fn()
beforeEach(() => {
  retrieval.rerankEnabled = false
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

describe("rerank", () => {
  it("is the identity function and makes no request when unconfigured", async () => {
    expect(await rerank("query", hits)).toEqual(hits)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("makes no request for a list too short to reorder", async () => {
    retrieval.rerankEnabled = true
    expect(await rerank("query", hits.slice(0, 1))).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("reorders by descending score when configured", async () => {
    retrieval.rerankEnabled = true
    fetchMock.mockResolvedValue({ ok: true, json: async () => [{ index: 0, score: 0.1 }, { index: 1, score: 0.9 }, { index: 2, score: 0.5 }] })
    expect((await rerank("query", hits)).map((hit) => hit.id)).toEqual(["b", "c", "a"])
  })

  it("keeps the fused order when the endpoint errors, times out, or returns junk", async () => {
    retrieval.rerankEnabled = true
    const failures = [
      () => fetchMock.mockResolvedValue({ ok: false, status: 503 }),
      () => fetchMock.mockRejectedValue(new Error("aborted")),
      () => fetchMock.mockResolvedValue({ ok: true, json: async () => ({ not: "an array" }) }),
      // Wrong length, an out-of-range index, and a duplicated index all mean the response does not
      // describe what was sent — trusting any of them would drop or repeat a result.
      () => fetchMock.mockResolvedValue({ ok: true, json: async () => [{ index: 0, score: 1 }] }),
      () => fetchMock.mockResolvedValue({ ok: true, json: async () => [{ index: 0, score: 1 }, { index: 9, score: 0.5 }, { index: 2, score: 0.1 }] }),
      () => fetchMock.mockResolvedValue({ ok: true, json: async () => [{ index: 1, score: 1 }, { index: 1, score: 0.5 }, { index: 2, score: 0.1 }] }),
    ]
    for (const setup of failures) {
      fetchMock.mockReset()
      setup()
      expect((await rerank("query", hits)).map((hit) => hit.id)).toEqual(["a", "b", "c"])
    }
  })

  it("never drops or duplicates a hit on the happy path", async () => {
    retrieval.rerankEnabled = true
    fetchMock.mockResolvedValue({ ok: true, json: async () => [{ index: 2, score: 0.3 }, { index: 0, score: 0.2 }, { index: 1, score: 0.9 }] })
    const result = await rerank("query", hits)
    expect(new Set(result.map((hit) => hit.id))).toEqual(new Set(["a", "b", "c"]))
    expect(result).toHaveLength(hits.length)
  })
})
