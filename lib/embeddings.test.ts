import { afterEach, describe, expect, it, vi } from "vitest"

const embeddings = { enabled: true, baseUrl: "https://emb.test", apiKey: "", format: "openai" as "openai" | "huggingface", modelName: "nomic-embed-text-v1", dimensions: 3, batchSize: 32, timeoutMs: 5_000 }
vi.mock("@/lib/config", () => ({ default: { embeddings } }))

const { embedTexts, toVectorLiteral } = await import("@/lib/embeddings")

type FetchCall = { url: string; init: RequestInit }

/** A fetch stub that returns, for each input in the request body, a 3-dim vector whose first
 * component is the integer trailing the input's marker ("doc#7" → [7,0,0]) — so ordering across
 * batches can be asserted from the returned vectors. */
function stubEchoFetch(): FetchCall[] {
  const calls: FetchCall[] = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const body = JSON.parse(init.body as string) as { input: string[] }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: body.input.map((text, index) => ({ index, embedding: [Number(text.split("#")[1] ?? 0), 0, 0] })) }),
    }
  }))
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
  embeddings.apiKey = ""
  embeddings.format = "openai"
})

describe("embedTexts", () => {
  it("applies the nomic task prefix for the kind", async () => {
    const calls = stubEchoFetch()
    await embedTexts(["invoice total"], "document")
    await embedTexts(["what is the total"], "query")
    expect(JSON.parse(calls[0].init.body as string).input[0]).toBe("search_document: invoice total")
    expect(JSON.parse(calls[1].init.body as string).input[0]).toBe("search_query: what is the total")
  })

  it("batches by batch size and preserves order across batches", async () => {
    const calls = stubEchoFetch()
    const inputs = Array.from({ length: 65 }, (_, i) => `doc#${i}`)
    const vectors = await embedTexts(inputs, "document")
    expect(calls).toHaveLength(3) // 32 + 32 + 1
    expect(vectors).toHaveLength(65)
    vectors.forEach((vec, index) => expect(vec[0]).toBe(index))
  })

  it("omits the Authorization header when no key is set", async () => {
    const calls = stubEchoFetch()
    await embedTexts(["x"], "document")
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it("sends a bearer token when a key is set", async () => {
    embeddings.apiKey = "secret-key"
    const calls = stubEchoFetch()
    await embedTexts(["x"], "document")
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer secret-key")
  })

  it("retries transient statuses then succeeds", async () => {
    let attempt = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      attempt++
      if (attempt === 1) return { ok: false, status: 500, json: async () => ({}) }
      if (attempt === 2) return { ok: false, status: 429, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ data: [{ index: 0, embedding: [1, 2, 3] }] }) }
    }))
    const vectors = await embedTexts(["x"], "document")
    expect(attempt).toBe(3)
    expect(vectors).toEqual([[1, 2, 3]])
  })

  it("does not retry an auth failure", async () => {
    let attempt = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      attempt++
      return { ok: false, status: 401, json: async () => ({}) }
    }))
    await expect(embedTexts(["x"], "document")).rejects.toThrow("embeddings_auth_failed")
    expect(attempt).toBe(1)
  })

  it("throws on a dimension mismatch without storing anything", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ index: 0, embedding: [1, 2] }] }) })))
    await expect(embedTexts(["x"], "document")).rejects.toThrow("embedding_dims_mismatch")
  })

  it("returns [] for no inputs without calling the endpoint", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    expect(await embedTexts([], "document")).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("embedTexts — Hugging Face format", () => {
  it("posts {inputs} to the feature-extraction pipeline URL and parses an array-of-arrays", async () => {
    embeddings.format = "huggingface"
    embeddings.modelName = "nomic-ai/nomic-embed-text-v1"
    const calls: FetchCall[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      const body = JSON.parse(init.body as string) as { inputs: string[]; normalize?: boolean }
      // HF returns a bare array of embeddings, in input order.
      return { ok: true, status: 200, json: async () => body.inputs.map((_, index) => [index, 0, 0]) }
    }))

    const vectors = await embedTexts(["alpha", "beta"], "document")

    expect(calls[0].url).toBe("https://emb.test/models/nomic-ai/nomic-embed-text-v1/pipeline/feature-extraction")
    const sent = JSON.parse(calls[0].init.body as string)
    expect(sent.inputs).toEqual(["search_document: alpha", "search_document: beta"])
    expect(sent.normalize).toBe(true)
    expect(sent.model).toBeUndefined() // must not send the OpenAI-shaped field
    expect(vectors).toEqual([[0, 0, 0], [1, 0, 0]])
    embeddings.modelName = "nomic-embed-text-v1"
  })

  it("wraps a single flat vector returned for a one-input request", async () => {
    embeddings.format = "huggingface"
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => [7, 8, 9] })))
    expect(await embedTexts(["only"], "query")).toEqual([[7, 8, 9]])
  })

  it("still validates dimensions on the HF path", async () => {
    embeddings.format = "huggingface"
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => [[1, 2]] })))
    await expect(embedTexts(["x"], "document")).rejects.toThrow("embedding_dims_mismatch")
  })
})

describe("toVectorLiteral", () => {
  it("formats a vector as a pgvector literal", () => {
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]")
  })
})
