import { beforeEach, describe, expect, it, vi } from "vitest"

const dictationConfig = { fastModelName: "" }
const aiConfig = { provider: "openai" as const, openaiApiKey: "key", openaiModelName: "main-model", geminiApiKey: "", geminiModelName: "" }

vi.mock("@/lib/config", () => ({ default: { get dictation() { return dictationConfig }, get ai() { return aiConfig } } }))

const requestLLM = vi.fn()
vi.mock("@/ai/providers/llmProvider", () => ({ requestLLM: (...args: unknown[]) => requestLLM(...args) }))

const { extractDictationCommands, buildExtractionPrompt } = await import("@/lib/dictation/extraction")

beforeEach(() => {
  requestLLM.mockReset()
  dictationConfig.fastModelName = ""
  aiConfig.openaiApiKey = "key"
})

describe("extractDictationCommands", () => {
  it("separates a spoken command from the content and reports it as explicit", async () => {
    requestLLM.mockResolvedValue({
      output: { requested_format: "table", format_source: "explicit", commands: ["make this a table"], cleaned_content: "Item one, ten units." },
      provider: "openai",
    })
    const result = await extractDictationCommands("Make this a table. Item one, ten units.")
    expect(result.commands).toEqual(["make this a table"])
    expect(result.requested_format).toBe("table")
    expect(result.format_source).toBe("explicit")
    expect(result.cleaned_content).toBe("Item one, ten units.")
  })

  it("reports inferred with no requested_format when nothing was spoken", async () => {
    requestLLM.mockResolvedValue({
      output: { requested_format: "", format_source: "inferred", commands: [], cleaned_content: "Just some notes." },
      provider: "openai",
    })
    const result = await extractDictationCommands("Just some notes.")
    expect(result.requested_format).toBeNull()
    expect(result.format_source).toBe("inferred")
  })

  it("falls back to the full transcript untouched on an LLM error", async () => {
    requestLLM.mockResolvedValue({ output: {}, provider: "openai", error: "ai_extraction_failed" })
    const result = await extractDictationCommands("Some dictation content.")
    expect(result).toEqual({ requested_format: null, format_source: "inferred", commands: [], cleaned_content: "Some dictation content." })
  })

  it("falls back to passthrough on malformed model output", async () => {
    requestLLM.mockResolvedValue({ output: { requested_format: "not_a_real_format", format_source: "explicit", commands: [], cleaned_content: "x" }, provider: "openai" })
    const result = await extractDictationCommands("Some dictation content.")
    expect(result.cleaned_content).toBe("Some dictation content.")
    expect(result.requested_format).toBeNull()
  })

  it("never throws, degrades to passthrough, when the request itself throws", async () => {
    requestLLM.mockRejectedValue(new Error("network down"))
    const result = await extractDictationCommands("Some dictation content.")
    expect(result.cleaned_content).toBe("Some dictation content.")
  })

  it("skips the call entirely with no API key configured", async () => {
    aiConfig.openaiApiKey = ""
    const result = await extractDictationCommands("Some dictation content.")
    expect(requestLLM).not.toHaveBeenCalled()
    expect(result.cleaned_content).toBe("Some dictation content.")
  })

  it("falls back to the full transcript when the model strips everything to empty content", async () => {
    requestLLM.mockResolvedValue({ output: { requested_format: "", format_source: "inferred", commands: ["um"], cleaned_content: "   " }, provider: "openai" })
    const result = await extractDictationCommands("Um, some content.")
    expect(result.cleaned_content).toBe("Um, some content.")
  })

  it("uses the configured fast model name when set", async () => {
    dictationConfig.fastModelName = "fast-model"
    requestLLM.mockResolvedValue({ output: { requested_format: "", format_source: "inferred", commands: [], cleaned_content: "x" }, provider: "openai" })
    await extractDictationCommands("x")
    expect(requestLLM).toHaveBeenCalledWith(
      expect.objectContaining({ providers: [expect.objectContaining({ model: "fast-model" })] }),
      expect.anything(),
    )
  })

  it("names every registered format in the prompt", () => {
    const prompt = buildExtractionPrompt("hello")
    expect(prompt).toContain("table")
    expect(prompt).toContain("soap_note")
  })
})
