import { BaseMessage, HumanMessage } from "@langchain/core/messages"
import { ChatOpenAI } from "@langchain/openai"
import { ChatGoogleGenerativeAI } from "@langchain/google-genai"

export type AnalyzeAttachment = { filename: string; contentType: string; base64: string }
export type LLMConfig = { provider: "openai" | "gemini"; apiKey: string; model: string }
export type LLMSettings = { providers: LLMConfig[] }
export type LLMRequest = { prompt: string; schema: Record<string, unknown>; attachments?: AnalyzeAttachment[]; textParts?: string[] }
export type LLMResponse = { output: Record<string, unknown>; provider: "openai" | "gemini"; error?: string }

/** Builds the multimodal message content: prompt first, then any OCR text parts, then
 * page images. Pages that OCR'd cleanly arrive as text (cheap); pages that fell back to
 * the vision path arrive as images, so one request can mix both. */
export function buildMessageContent(request: LLMRequest) {
  return [
    { type: "text", text: request.prompt },
    ...(request.textParts || []).map((text) => ({ type: "text", text })),
    ...(request.attachments || []).map((attachment) => ({ type: "image_url", image_url: { url: `data:${attachment.contentType};base64,${attachment.base64}` } })),
  ]
}

/** Extracts the largest parseable JSON object from model text, tolerating markdown
 * fences, trailing garbage, and truncated output (e.g. a response cut at the token
 * cap mid-string). Truncation loses only the tail; everything before it survives. */
export function salvageJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{")
  if (start < 0) throw new Error("no_json_in_response")
  const raw = text.slice(start)
  try {
    return JSON.parse(raw)
  } catch {
    /* fall through to repair */
  }
  // Walk the text tracking string/escape state and open brackets; remember positions
  // right after a completed value where the object could be validly closed.
  const stackAt: string[][] = []
  const safePoints: number[] = []
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === "{" || ch === "[") stack.push(ch)
    else if (ch === "}" || ch === "]") stack.pop()
    if (!inString && (ch === "}" || ch === "]" || ch === '"' || /[\d\w]/.test(ch))) {
      safePoints.push(i + 1)
      stackAt.push([...stack])
    }
  }
  for (let attempt = safePoints.length - 1; attempt >= 0 && attempt >= safePoints.length - 500; attempt--) {
    const end = safePoints[attempt]
    const closers = [...stackAt[attempt]].reverse().map((b) => (b === "{" ? "}" : "]")).join("")
    try {
      return JSON.parse(raw.slice(0, end) + closers)
    } catch {
      /* try an earlier safe point */
    }
  }
  throw new Error("unparseable_json_response")
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.map((part) => (typeof part === "string" ? part : (part as { text?: string }).text || "")).join("")
  return ""
}

export async function requestLLM(settings: LLMSettings, request: LLMRequest): Promise<LLMResponse> {
  const config = settings.providers[0]
  if (!config?.apiKey || !config.model) return { output: {}, provider: config?.provider ?? "openai", error: "platform_ai_not_configured" }
  try {
    const content = buildMessageContent(request)

    if (config.provider === "gemini") {
      // Gemini structured-output mode is brittle for dense documents: constrained decoding
      // can loop until the token cap and a single malformed character voids the whole
      // response. Ask for plain JSON and salvage whatever parses instead.
      // Temperature 1 because Gemini 2.5+ models degrade and repeat at temperature 0.
      const model = new ChatGoogleGenerativeAI({ apiKey: config.apiKey, model: config.model, temperature: 1, maxOutputTokens: 65536 })
      const jsonPrompt = `${request.prompt}\n\nRespond with a single JSON object only — no markdown, no commentary. It must match this JSON schema:\n${JSON.stringify(request.schema)}`
      const response = await model.invoke([new HumanMessage({ content: [{ type: "text", text: jsonPrompt }, ...content.slice(1)] })])
      const output = salvageJsonObject(messageText(response.content))
      return { output, provider: config.provider }
    }

    const model = new ChatOpenAI({ apiKey: config.apiKey, model: config.model, temperature: 0 })
    const messages: BaseMessage[] = [new HumanMessage({ content })]
    const output = await model.withStructuredOutput(request.schema, { name: "document_extraction" }).invoke(messages) as Record<string, unknown>
    return { output, provider: config.provider }
  } catch (error) {
    console.error("LLM request failed:", error instanceof Error ? error.message : error)
    return { output: {}, provider: config.provider, error: "ai_extraction_failed" }
  }
}
