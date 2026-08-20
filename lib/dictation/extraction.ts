import { requestLLM } from "@/ai/providers/llmProvider"
import config from "@/lib/config"
import { DICTATION_FORMATS } from "@/lib/dictation/formats"
import { z } from "zod"

/** Stage B — command/content separation for agnostic dictation.
 *
 * One constrained LLM call that splits a transcript into the spoken META-INSTRUCTIONS ("make this
 * a table", "send this as an email") and the actual dictated CONTENT, and separately reports
 * whether an explicit output format was spoken. This is a different question from the field
 * extraction lib/document-transcription.ts already runs ("restructure, never infer") — that pass
 * sorts values into fields; this one decides what the speaker wants DONE with the dictation before
 * that sorting even happens. Both read the same transcript; neither replaces the other. */

export const DICTATION_FORMAT_NAMES = DICTATION_FORMATS.map((format) => format.name)

// The model is asked for a plain string, with "" meaning "no format was spoken" — every other JSON
// schema in this codebase avoids a nullable type (buildDocumentJsonSchema, ROUTER_SCHEMA,
// suggestedFieldsSchemaProperty all use empty-string/empty-array sentinels instead), and structured-
// output providers are less consistent about honouring a `["string","null"]` type union than a
// plain enum. Transformed to `string | null` here so the rest of the codebase never sees "".
const requestedFormatField = z.union([z.enum(DICTATION_FORMAT_NAMES as [string, ...string[]]), z.literal("")])
  .transform((value) => (value === "" ? null : value))

/** The DictationExtraction shape. Parsed defensively (safeParse, never `.parse`) because this
 * reads raw model output — the house rule everywhere an LLM's JSON is consumed (see
 * lib/query-router.ts, lib/field-suggestions.ts): a malformed or hallucinated response must degrade
 * to a safe default, never throw and never block a recording that has already been made. */
export const dictationExtractionSchema = z.object({
  requested_format: requestedFormatField,
  format_source: z.enum(["explicit", "inferred"]),
  commands: z.array(z.string().max(300)).max(20),
  cleaned_content: z.string().max(100_000),
})

export type DictationExtraction = z.infer<typeof dictationExtractionSchema>

/** What every caller gets on any failure: no commands stripped, the full transcript as content,
 * and nothing claimed about format — the resolver (lib/dictation/pipeline.ts) then falls back to
 * the route's or template's default exactly as if this call had never run. */
function passthrough(transcript: string): DictationExtraction {
  return { requested_format: null, format_source: "inferred", commands: [], cleaned_content: transcript }
}

export function buildExtractionPrompt(transcript: string): string {
  return [
    "The text below is an automatic transcript of a spoken dictation. Separate two things:",
    "",
    "1. COMMANDS — meta-instructions the speaker gave about what to DO with the dictation or how to",
    "   present it, e.g. \"make this a table\", \"draft this as an email\", \"just bullet points\",",
    "   \"structure it as a SOAP note\". Return each such instruction verbatim in `commands`.",
    "2. CONTENT — everything else: the actual substance being dictated. Return it in",
    "   `cleaned_content`, with the commands themselves and filler/false-starts removed, but",
    "   otherwise UNCHANGED — do not summarise, rephrase, or add anything.",
    "",
    "If a command names a specific output format, set `requested_format` to whichever of these it",
    `matches most closely: ${DICTATION_FORMAT_NAMES.join(", ")}. Set \`format_source\` to "explicit"`,
    "in that case. If no command named a format, set `requested_format` to an empty string and",
    "`format_source` to \"inferred\". Never guess a format from the CONTENT alone — only from an",
    "explicit spoken instruction.",
    "",
    "If the speaker gave no commands at all, return an empty `commands` array and `cleaned_content`",
    "equal to the transcript with only filler and false starts removed.",
    "",
    "Transcript:",
    transcript,
  ].join("\n")
}

const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    requested_format: { type: "string", enum: [...DICTATION_FORMAT_NAMES, ""], description: "The explicitly spoken output format, or an empty string if none was spoken" },
    format_source: { type: "string", enum: ["explicit", "inferred"] },
    commands: { type: "array", items: { type: "string" }, description: "Verbatim spoken meta-instructions" },
    cleaned_content: { type: "string", description: "The dictated content with commands and filler removed" },
  },
  required: ["requested_format", "format_source", "commands", "cleaned_content"],
  additionalProperties: false,
} as const

/** Runs Stage B against a transcript. Never throws — on any configuration or model failure this
 * returns the same passthrough a caller would get by skipping Stage B entirely, so agnostic
 * dictation degrades to "no commands found, use the route/template default" rather than blocking. */
export async function extractDictationCommands(transcript: string): Promise<DictationExtraction> {
  const trimmed = transcript.trim()
  if (!trimmed) return passthrough(transcript)

  // The fast/small model, falling back to the main structuring model when unset — see
  // DICTATION_FAST_MODEL_NAME in lib/config.ts. Same provider/key resolution as every other LLM
  // call in the app (lib/document-transcription.ts, lib/query-router.ts).
  const provider = config.ai.provider
  const apiKey = provider === "gemini" ? config.ai.geminiApiKey : config.ai.openaiApiKey
  const model = config.dictation.fastModelName || (provider === "gemini" ? config.ai.geminiModelName : config.ai.openaiModelName)
  if (!apiKey) return passthrough(transcript)

  try {
    const response = await requestLLM({ providers: [{ provider, apiKey, model }] }, { prompt: buildExtractionPrompt(trimmed), schema: EXTRACTION_JSON_SCHEMA })
    if (response.error) return passthrough(transcript)
    const parsed = dictationExtractionSchema.safeParse(response.output)
    if (!parsed.success) return passthrough(transcript)
    // An empty cleaned_content (the model stripped everything) would silently drop the whole
    // dictation from every downstream step — degrade to the full transcript instead.
    if (!parsed.data.cleaned_content.trim()) return { ...parsed.data, cleaned_content: transcript }
    return parsed.data
  } catch (error) {
    console.error("dictation extraction: falling back to passthrough:", error instanceof Error ? error.message : error)
    return passthrough(transcript)
  }
}
