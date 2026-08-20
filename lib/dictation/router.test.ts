import { beforeEach, describe, expect, it, vi } from "vitest"

const dictationConfig = { routerEnabled: true, routeThreshold: 0.5, fastModelName: "" }
const embeddingsConfig = { enabled: true }

vi.mock("@/lib/config", () => ({ default: { get dictation() { return dictationConfig }, get embeddings() { return embeddingsConfig } } }))

// A tiny deterministic "embedding": one-hot on which route family a sentence belongs to, keyed by
// a keyword each fixture sentence contains. Real embeddings would cluster the same way; this just
// avoids a network call while still exercising real cosine-similarity math in router.ts.
const DIMS = ["pathology", "finance", "logistics", "email", "summary", "todo", "note"]
function fakeVector(text: string): number[] {
  const lower = text.toLowerCase()
  const vector = DIMS.map((dim) => (lower.includes(dim) ? 1 : 0))
  if (!vector.some(Boolean)) vector[vector.length - 1] = 0.01 // near-zero, never wins
  return vector
}

const embedTexts = vi.fn(async (inputs: string[]) => inputs.map(fakeVector))
vi.mock("@/lib/embeddings", () => ({ embedTexts: (...args: Parameters<typeof embedTexts>) => embedTexts(...args) }))

vi.mock("@/lib/dictation/intents", () => ({
  DICTATION_ROUTES: [
    { name: "pathology_report", defaultFormat: "soap_note", examples: ["specimen pathology diagnosis"] },
    { name: "finance_record", defaultFormat: "table", examples: ["invoice finance payment"] },
  ],
}))

const { routeDictation, __resetRouteCentroidsForTest } = await import("@/lib/dictation/router")

beforeEach(() => {
  embedTexts.mockClear()
  dictationConfig.routerEnabled = true
  dictationConfig.routeThreshold = 0.5
  embeddingsConfig.enabled = true
  __resetRouteCentroidsForTest()
})

describe("routeDictation", () => {
  it("routes a clear match to the right route", async () => {
    const result = await routeDictation("This pathology specimen shows a diagnosis of carcinoma.")
    expect(result.intent).toBe("pathology_report")
    expect(result.via).toBe("matched")
    expect(result.score).toBeGreaterThan(dictationConfig.routeThreshold)
  })

  it("falls back to general below the confidence threshold", async () => {
    dictationConfig.routeThreshold = 0.99
    // Mentions both dimensions, so the best match is a partial cosine similarity rather than 1.0.
    const result = await routeDictation("Somewhere between a pathology note and a finance record.")
    expect(result.intent).toBe("general")
    expect(result.via).toBe("below_threshold")
  })

  it("falls back to general on an out-of-set utterance", async () => {
    const result = await routeDictation("Just rambling about my day with nothing in particular.")
    expect(result.intent).toBe("general")
  })

  it("never routes when the feature is off", async () => {
    dictationConfig.routerEnabled = false
    const result = await routeDictation("invoice finance payment")
    expect(result.intent).toBe("general")
    expect(result.via).toBe("disabled")
    expect(embedTexts).not.toHaveBeenCalled()
  })

  it("never routes when embeddings are not configured", async () => {
    embeddingsConfig.enabled = false
    const result = await routeDictation("invoice finance payment")
    expect(result.intent).toBe("general")
    expect(result.via).toBe("not_configured")
  })

  it("degrades to general, never throws, on an embedding failure", async () => {
    embedTexts.mockRejectedValueOnce(new Error("network down"))
    const result = await routeDictation("invoice finance payment")
    expect(result.intent).toBe("general")
    expect(result.via).toBe("embedding_failed")
  })

  it("embeds each route's examples exactly once across repeated calls", async () => {
    await routeDictation("invoice finance payment")
    await routeDictation("specimen pathology diagnosis")
    // One batched call for the route centroids (shared across both routes) plus one per-query call.
    const centroidCalls = embedTexts.mock.calls.filter((call) => call[1] === "document")
    expect(centroidCalls.length).toBe(2) // one per route in this fixture (no shared batching across routes here)
  })
})
