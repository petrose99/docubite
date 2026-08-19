import { beforeEach, describe, expect, it, vi } from "vitest"

const asr = { enabled: true, backend: "deepgram" as const, baseUrl: "", apiKey: "k", modelName: "nova-2", timeoutMs: 1000, maxAudioBytes: 1024, language: "en" }
vi.mock("@/lib/config", () => ({ default: { get asr() { return asr } } }))

const { DeepgramAsrBackend, parseAsrResponse, parseSegments } = await import("@/lib/asr/deepgram")

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  asr.maxAudioBytes = 1024
  asr.apiKey = "k"
  asr.modelName = "nova-2"
})

const audio = Buffer.from("fake audio")
const backend = () => new DeepgramAsrBackend()

describe("parseSegments", () => {
  it("prefers utterances, sorted in time order", () => {
    expect(
      parseSegments({
        results: {
          utterances: [
            { transcript: "second", start: 2.5, end: 4.0 },
            { transcript: "first", start: 0, end: 2.5 },
          ],
        },
      })
    ).toEqual([
      { startMs: 0, endMs: 2500, text: "first" },
      { startMs: 2500, endMs: 4000, text: "second" },
    ])
  })

  it("falls back to word-level timestamps when there are no utterances", () => {
    expect(
      parseSegments({
        results: { channels: [{ alternatives: [{ words: [{ punctuated_word: "hi", start: 0, end: 0.5 }] }] }] },
      })
    ).toEqual([{ startMs: 0, endMs: 500, text: "hi" }])
  })

  it("drops a span with no usable start rather than placing it at zero", () => {
    expect(parseSegments({ results: { utterances: [{ transcript: "orphan" }] } })).toEqual([])
  })

  it("drops empty text and tolerates a missing results object", () => {
    expect(parseSegments({ results: { utterances: [{ transcript: "   ", start: 0, end: 1 }] } })).toEqual([])
    expect(parseSegments({})).toEqual([])
  })
})

describe("parseAsrResponse", () => {
  it("reads the transcript, detected language, and segments, and records the model", () => {
    const result = parseAsrResponse(
      {
        results: { channels: [{ alternatives: [{ transcript: " hello " }] }], utterances: [{ transcript: "hello", start: 0, end: 1 }] },
        metadata: { detected_language: "en" },
      },
      "m"
    )
    expect(result).toEqual({ text: "hello", segments: [{ startMs: 0, endMs: 1000, text: "hello" }], language: "en", model: "m" })
  })

  it("tolerates a response with no results at all", () => {
    expect(parseAsrResponse({}, "m")).toEqual({ text: "", segments: [], language: null, model: "m" })
  })
})

describe("DeepgramAsrBackend", () => {
  it("reports that it can apply bias terms — Deepgram supports keyword biasing natively", () => {
    expect(backend().supportsBiasTerms).toBe(true)
  })

  it("sends raw audio bytes with the mime type as Content-Type, not a JSON envelope", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ results: { channels: [{ alternatives: [{ transcript: "x" }] }] } }) })
    await backend().transcribe(audio, { mimeType: "audio/webm" })
    const [url, init] = fetchMock.mock.calls[0]
    expect(init.headers["Content-Type"]).toBe("audio/webm")
    expect(init.headers["Authorization"]).toBe("Token k")
    expect(init.body).toBe(audio)
    expect(url).toContain("utterances=true")
    expect(url).toContain("model=nova-2")
  })

  it("passes bias terms as repeated keywords params on nova-2, and the language hint as a query param", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ results: { channels: [{ alternatives: [{ transcript: "x" }] }] } }) })
    await backend().transcribe(audio, { mimeType: "audio/webm", language: "en", biasTerms: ["stat", "afib"] })
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.searchParams.get("language")).toBe("en")
    expect(url.searchParams.getAll("keywords")).toEqual(["stat", "afib"])
    expect(url.searchParams.getAll("keyterm")).toEqual([])
  })

  it("passes bias terms as keyterm on nova-3 — it dropped the keywords param entirely", async () => {
    asr.modelName = "nova-3-medical"
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ results: { channels: [{ alternatives: [{ transcript: "x" }] }] } }) })
    await backend().transcribe(audio, { mimeType: "audio/webm", biasTerms: ["stat", "afib"] })
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.searchParams.getAll("keyterm")).toEqual(["stat", "afib"])
    expect(url.searchParams.getAll("keywords")).toEqual([])
    expect(url.searchParams.get("model")).toBe("nova-3-medical")
  })

  it("refuses audio over the configured size without calling the endpoint", async () => {
    asr.maxAudioBytes = 2
    await expect(backend().transcribe(audio, { mimeType: "audio/webm" })).rejects.toThrow("asr_audio_too_large")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses empty audio and an unconfigured backend", async () => {
    await expect(backend().transcribe(Buffer.alloc(0), { mimeType: "audio/webm" })).rejects.toThrow("asr_audio_empty")
    asr.apiKey = ""
    await expect(backend().transcribe(audio, { mimeType: "audio/webm" })).rejects.toThrow("asr_not_configured")
  })

  it("throws immediately on a permanent status instead of burning retries", async () => {
    for (const [status, code] of [[400, "asr_bad_request"], [401, "asr_auth_failed"], [413, "asr_audio_too_large"]] as const) {
      fetchMock.mockReset().mockResolvedValue({ ok: false, status })
      await expect(backend().transcribe(audio, { mimeType: "audio/webm" })).rejects.toThrow(code)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it("retries a transient 503", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: { channels: [{ alternatives: [{ transcript: "warmed up" }] }] } }) })
    const result = await backend().transcribe(audio, { mimeType: "audio/webm" })
    expect(result.text).toBe("warmed up")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("rejects an empty transcript rather than storing a blank dictation", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ results: { channels: [{ alternatives: [{ transcript: "  " }] }] } }) })
    await expect(backend().transcribe(audio, { mimeType: "audio/webm" })).rejects.toThrow("asr_empty_transcript")
  })
})
