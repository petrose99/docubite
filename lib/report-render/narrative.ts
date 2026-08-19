import { requestLLM } from "@/ai/providers/llmProvider"
import config from "@/lib/config"
import { z } from "zod"

/** Narrative report sections (gross description, microscopic description, comment).
 *
 * Unlike the synoptic half, these are prose, so an LLM writes them. Everything about the prompt and
 * the schema exists to stop it writing anything that was not dictated:
 *
 * - It is given the transcript and the extracted values, and told they are the ONLY permitted
 *   source. No world knowledge, no typical findings, no "consistent with" inferences.
 * - A section with nothing dictated must come back as the literal marker, not as a plausible
 *   paragraph. An empty section is a correct answer here.
 * - Uncertain audio is marked [unclear] rather than resolved to the likelier word.
 *
 * A model can still ignore instructions, which is exactly why the diagnosis, grade, stage and
 * margins live in the SYNOPTIC half — rendered deterministically by code that cannot invent — and
 * why nothing this file produces can be signed without a person clearing the checklist. */

export const narrativeSectionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  title: z.string().min(1).max(120),
  instruction: z.string().max(500).default(""),
})

export const narrativeSectionsSchema = z.array(narrativeSectionSchema).max(20)
export type NarrativeSection = z.infer<typeof narrativeSectionSchema>

export function parseNarrativeSections(sections: unknown): NarrativeSection[] {
  return narrativeSectionsSchema.parse(sections)
}

/** What a section renders as when the dictation said nothing about it. Checked for by the
 * completeness report, and visible to the reader. */
export const NOT_DICTATED = "[not dictated]"

function buildNarrativeSchema(sections: NarrativeSection[]) {
  return {
    type: "object",
    properties: Object.fromEntries(sections.map((section) => [section.key, {
      type: "string",
      description: `${section.title}. ${section.instruction} Use ONLY what the transcript states. If the transcript says nothing about this section, return exactly "${NOT_DICTATED}".`,
    }])),
    required: sections.map((section) => section.key),
    additionalProperties: false,
  }
}

export function buildNarrativePrompt(sections: NarrativeSection[], transcript: string, values: Record<string, unknown>, biasTerms: string[]): string {
  return [
    "You are transcribing a dictated pathology report into named sections. You are NOT writing a report.",
    "",
    "Absolute rules:",
    "- Use ONLY what the transcript below states. Never add a finding, measurement, diagnosis, or interpretation that was not dictated.",
    "- Never infer what is 'typical' or 'expected' for the specimen. Absence of a finding in the dictation is NOT evidence the finding is absent.",
    `- If the dictation says nothing about a section, return exactly "${NOT_DICTATED}" for it. An empty section is correct and expected.`,
    "- Where the audio was unclear or a word is uncertain, write [unclear] at that point rather than guessing the likelier word.",
    "- Do not restate the synoptic values; they are rendered separately. Reference them only where the dictation itself does.",
    "- Keep the dictated wording. Tidy grammar and remove filler, but do not rephrase clinical statements.",
    "",
    ...(biasTerms.length ? [
      "Domain vocabulary — the speech-to-text step may have mis-transcribed these; correct an obvious phonetic",
      "mangling of one of them, but never substitute one for a word that was clearly something else:",
      biasTerms.join(", "),
      "",
    ] : []),
    "Sections to fill:",
    ...sections.map((section) => `- ${section.key} (${section.title}): ${section.instruction || "as dictated"}`),
    "",
    "Values already extracted from this dictation (for context only — do not repeat them verbatim):",
    JSON.stringify(values),
    "",
    "Transcript:",
    transcript,
  ].join("\n")
}

/** Generates the narrative sections. Returns every section key, always: on any failure each one is
 * the NOT_DICTATED marker rather than absent, so a downstream renderer never has to guess whether
 * an empty section means "nothing was said" or "generation broke". */
export async function renderNarrative(
  sections: NarrativeSection[],
  transcript: string,
  values: Record<string, unknown>,
  biasTerms: string[] = [],
): Promise<Record<string, string>> {
  const blank = Object.fromEntries(sections.map((section) => [section.key, NOT_DICTATED]))
  if (!sections.length || !transcript.trim()) return blank

  const apiKey = config.ai.provider === "gemini" ? config.ai.geminiApiKey : config.ai.openaiApiKey
  const model = config.ai.provider === "gemini" ? config.ai.geminiModelName : config.ai.openaiModelName
  if (!apiKey) return blank

  const response = await requestLLM(
    { providers: [{ provider: config.ai.provider, apiKey, model }] },
    { prompt: buildNarrativePrompt(sections, transcript, values, biasTerms), schema: buildNarrativeSchema(sections) },
  )
  if (response.error) return blank

  return Object.fromEntries(sections.map((section) => {
    const raw = response.output[section.key]
    const text = typeof raw === "string" ? raw.trim() : ""
    return [section.key, text || NOT_DICTATED]
  }))
}
