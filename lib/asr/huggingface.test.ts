import { beforeEach, describe, expect, it, vi } from "vitest"

const asr = { enabled: true, backend: "huggingface" as const, baseUrl: "https://asr.test", apiKey: "k", modelName: "openai/whisper-large-v3-turbo", timeoutMs: 1000, maxAudioBytes: 1024 }
vi.mock("@/lib/config", () => ({ default: { get asr() { return asr } } }))

const { HuggingFaceAsrBackend, parseAsrResponse, parseSegments } = await import("@/lib/asr/huggingface")
const { isSupportedAudioBuffer } = await import("@/lib/asr/types")

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  asr.maxAudioBytes = 1024
  asr.baseUrl = "https://asr.test"
})

const audio = Buffer.from("fake audio")
const backend = () => new HuggingFaceAsrBackend()

describe("parseSegments", () => {
  it("converts HF chunks to millisecond spans, in time order", () => {
    expect(parseSegments([
      { text: "second", timestamp: [2.5, 4.0] },
      { text: "first", timestamp: [0, 2.5] },
    ])).toEqual([
      { startMs: 0, endMs: 2500, text: "first" },
      { startMs: 2500, endMs: 4000, text: "second" },
    ])
  })

  it("treats a null end (the last word-level chunk) as a zero-length span at the start", () => {
    expect(parseSegments([{ text: "trailing", timestamp: [1.2, null] }])).toEqual([{ startMs: 1200, endMs: 1200, text: "trailing" }])
  })

  it("drops a chunk with no usable start rather than placing it at zero", () => {
    // A wrong timestamp points an audio citation at the wrong moment, which is worse than none.
    expect(parseSegments([{ text: "orphan", timestamp: [null, 3] }, { text: "no stamp" }])).toEqual([])
  })

  it("drops empty text and tolerates a missing chunks array", () => {
    expect(parseSegments([{ text: "   ", timestamp: [0, 1] }])).toEqual([])
    expect(parseSegments(undefined)).toEqual([])
  })
})

describe("parseAsrResponse", () => {
  it("reads text and segments and records the model", () => {
    const result = parseAsrResponse({ text: " hello ", chunks: [{ text: "hello", timestamp: [0, 1] }] }, "m")
    expect(result).toEqual({ text: "hello", segments: [{ startMs: 0, endMs: 1000, text: "hello" }], language: null, model: "m" })
  })

  it("tolerates a response with no chunks at all", () => {
    expect(parseAsrResponse({ text: "hi" }, "m").segments).toEqual([])
  })
})

describe("HuggingFaceAsrBackend", () => {
  it("reports that it cannot apply bias terms, rather than silently ignoring them", () => {
    // Whisper on HF serverless has no biasing parameter; claiming otherwise would let callers
    // report domain biasing that never happened.
    expect(backend().supportsBiasTerms).toBe(false)
  })

  it("requests timestamps — audio provenance depends on them", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ text: "x", chunks: [] }) })
    await backend().transcribe(audio, { mimeType: "audio/webm" })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.parameters.return_timestamps).toBe(true)
    expect(body.inputs).toBe(audio.toString("base64"))
    expect(fetchMock.mock.calls[0][0]).toBe("https://asr.test/models/openai/whisper-large-v3-turbo")
  })

  it("sends the language hint inside generate_kwargs, never at the top of parameters", async () => {
    // Top-level `language` is rejected with HTTP 400:
    // "_sanitize_parameters() got an unexpected keyword argument 'language'".
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ text: "x", chunks: [] }) })
    await backend().transcribe(audio, { mimeType: "audio/webm", language: "en" })
    const { parameters } = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(parameters.language).toBeUndefined()
    expect(parameters.generate_kwargs).toEqual({ language: "en", task: "transcribe" })
  })

  it("omits generate_kwargs entirely when no language is given", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ text: "x", chunks: [] }) })
    await backend().transcribe(audio, { mimeType: "audio/webm", language: null })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).parameters.generate_kwargs).toBeUndefined()
  })

  it("refuses audio over the configured size without calling the endpoint", async () => {
    asr.maxAudioBytes = 2
    await expect(backend().transcribe(audio, { mimeType: "audio/webm" })).rejects.toThrow("asr_audio_too_large")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses empty audio and an unconfigured backend", async () => {
    await expect(backend().transcribe(Buffer.alloc(0), { mimeType: "audio/webm" })).rejects.toThrow("asr_audio_empty")
    asr.baseUrl = ""
    await expect(backend().transcribe(audio, { mimeType: "audio/webm" })).rejects.toThrow("asr_not_configured")
  })

  it("throws immediately on a permanent status instead of burning retries", async () => {
    for (const [status, code] of [[400, "asr_bad_request"], [401, "asr_auth_failed"], [413, "asr_audio_too_large"]] as const) {
      fetchMock.mockReset().mockResolvedValue({ ok: false, status })
      await expect(backend().transcribe(audio, { mimeType: "audio/webm" })).rejects.toThrow(code)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  })

  it("retries a transient 503 — HF returns it while a serverless model cold-starts", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ text: "warmed up", chunks: [] }) })
    const result = await backend().transcribe(audio, { mimeType: "audio/webm" })
    expect(result.text).toBe("warmed up")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("rejects an empty transcript rather than storing a blank dictation", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ text: "  ", chunks: [] }) })
    await expect(backend().transcribe(audio, { mimeType: "audio/webm" })).rejects.toThrow("asr_empty_transcript")
  })
})

describe("isSupportedAudioBuffer", () => {
  const cases: Array<[string, Buffer, boolean]> = [
    ["audio/webm", Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]), true],
    ["audio/ogg", Buffer.from("OggS____"), true],
    ["audio/wav", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")]), true],
    ["audio/flac", Buffer.from("fLaC____"), true],
    ["audio/mp4", Buffer.concat([Buffer.alloc(4), Buffer.from("ftypM4A ")]), true],
    ["audio/mpeg", Buffer.from("ID3_____"), true],
    ["audio/mpeg", Buffer.from([0xff, 0xfb, 0, 0]), true],
  ]

  it.each(cases)("accepts a well-formed %s", (mime, buffer, expected) => {
    expect(isSupportedAudioBuffer(buffer, mime)).toBe(expected)
  })

  it("rejects a mismatched container — a declared Content-Type is a claim, not a check", () => {
    expect(isSupportedAudioBuffer(Buffer.from("OggS____"), "audio/webm")).toBe(false)
    expect(isSupportedAudioBuffer(Buffer.from("%PDF-1.7"), "audio/mpeg")).toBe(false)
    expect(isSupportedAudioBuffer(Buffer.from("RIFF____AVI "), "audio/wav")).toBe(false)
  })

  it("rejects an audio type not on the supported list", () => {
    expect(isSupportedAudioBuffer(Buffer.from("OggS____"), "audio/aiff")).toBe(false)
  })
})
