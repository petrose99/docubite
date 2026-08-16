import { describe, expect, it } from "vitest"
import { buildMessageContent, salvageJsonObject } from "./llmProvider"

describe("salvageJsonObject", () => {
  it("parses clean JSON", () => {
    expect(salvageJsonObject('{"a": 1}')).toEqual({ a: 1 })
  })

  it("strips markdown fences and prose", () => {
    expect(salvageJsonObject('Here you go:\n```json\n{"a": "b"}\n```')).toEqual({ a: "b" })
  })

  it("salvages output truncated mid-string", () => {
    const truncated = '{"vendor": "Acme", "line_items": [{"description": "Widget", "amount": 5}, {"description": "Gad'
    const result = salvageJsonObject(truncated)
    expect(result.vendor).toBe("Acme")
    expect((result.line_items as unknown[]).length).toBeGreaterThanOrEqual(1)
  })

  it("salvages output truncated mid-array", () => {
    const truncated = '{"total": 99.5, "line_items": [{"description": "A", "amount": 1}, {"description": "B", "amount": 2},'
    const result = salvageJsonObject(truncated)
    expect(result.total).toBe(99.5)
    expect((result.line_items as unknown[]).length).toBe(2)
  })

  it("throws when no JSON object exists", () => {
    expect(() => salvageJsonObject("no json here")).toThrow()
  })
})

describe("buildMessageContent", () => {
  const attachment = { filename: "page.webp", contentType: "image/webp", base64: "AAAA" }

  it("puts the prompt first, then OCR text, then images", () => {
    expect(buildMessageContent({ prompt: "Extract", schema: {}, textParts: ["page 1 text"], attachments: [attachment] })).toEqual([
      { type: "text", text: "Extract" },
      { type: "text", text: "page 1 text" },
      { type: "image_url", image_url: { url: "data:image/webp;base64,AAAA" } },
    ])
  })

  it("sends text only when every page OCR'd", () => {
    const content = buildMessageContent({ prompt: "Extract", schema: {}, textParts: ["a", "b"] })
    expect(content).toHaveLength(3)
    expect(content.every((part) => part.type === "text")).toBe(true)
  })

  it("matches the original vision-only shape when there are no text parts", () => {
    expect(buildMessageContent({ prompt: "Extract", schema: {}, attachments: [attachment] })).toEqual([
      { type: "text", text: "Extract" },
      { type: "image_url", image_url: { url: "data:image/webp;base64,AAAA" } },
    ])
  })

  it("keeps the prompt at index 0 so the Gemini path can swap it via slice(1)", () => {
    const content = buildMessageContent({ prompt: "Extract", schema: {}, textParts: ["t"], attachments: [attachment] })
    expect(content[0]).toEqual({ type: "text", text: "Extract" })
    expect(content.slice(1)).toHaveLength(2)
  })
})
