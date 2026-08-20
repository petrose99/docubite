import type { NarrativeSection } from "@/lib/report-render/narrative"

/** The output-format registry for agnostic dictation.
 *
 * A format is NOT a field schema. The field schema (a template's `fields`) decides what gets
 * extracted from the transcript into the structured spine; a format decides how the *report* built
 * from those fields reads — a table, an email, a SOAP note, a bullet list. The two are orthogonal:
 * a pathology dictation has pathology fields AND (today) a SOAP-note format; an email draft has
 * whatever fields discover mode finds AND an email format. See lib/report-templates.ts for the
 * field-schema half.
 *
 * Deliberately reuses the existing report machinery rather than inventing a new renderer: each
 * format is just a `NarrativeSection[]` in the shape lib/report-render/narrative.ts already
 * consumes (LLM-written prose per section, told to use ONLY what was dictated, "[not dictated]"
 * where the speaker said nothing). The deterministic synoptic block (lib/report-render/synoptic.ts)
 * still renders alongside every format from the document's own discovered fields — that half never
 * changes regardless of format, because it is the part that cannot be wrong. */

export type DictationFormat = {
  name: string
  label: string
  sections: NarrativeSection[]
}

const narrativeSection = (key: string, title: string, instruction: string): NarrativeSection => ({ key, title, instruction })

export const DICTATION_FORMATS: DictationFormat[] = [
  {
    name: "narrative",
    label: "Narrative",
    sections: [
      narrativeSection("summary", "Summary", "A concise summary of what was dictated."),
      narrativeSection("details", "Details", "Any further detail or observation that belongs in the body rather than the summary."),
    ],
  },
  {
    // No narrative sections at all — the deterministic synoptic block (rendered from the document's
    // own fields regardless of format) IS the whole report. Explicitly spoken ("just give me the
    // values", "no write-up") or the default for a route with a fixed, self-describing schema.
    name: "synoptic",
    label: "Synoptic only",
    sections: [],
  },
  {
    name: "table",
    label: "Table",
    sections: [
      narrativeSection("table", "Table", "Present everything dictated as a markdown table, one row per distinct item or fact stated. Infer sensible column headers from what was said."),
    ],
  },
  {
    name: "email",
    label: "Email",
    sections: [
      narrativeSection("email", "Email", "Draft as an email: a greeting, a body covering everything dictated, and a sign-off. Do not invent a recipient or sender name that was not stated — use a placeholder like [recipient] instead."),
    ],
  },
  {
    name: "soap_note",
    label: "SOAP note",
    sections: [
      narrativeSection("subjective", "Subjective", "What the patient or speaker reported, in their own words or a close paraphrase."),
      narrativeSection("objective", "Objective", "Observed or measured findings the speaker stated."),
      narrativeSection("assessment", "Assessment", "The speaker's stated assessment or impression. Do not infer a diagnosis they did not state."),
      narrativeSection("plan", "Plan", "The stated plan or next steps."),
    ],
  },
  {
    name: "bullets",
    label: "Bullet points",
    sections: [
      narrativeSection("bullets", "Summary", "Present everything dictated as a concise bulleted list, one bullet per distinct point."),
    ],
  },
  {
    name: "todo",
    label: "To-do list",
    sections: [
      narrativeSection("todo", "To-do", "List every task, action item, or reminder the speaker stated, one per line as a checklist item."),
    ],
  },
]

export const DEFAULT_FORMAT_NAME = "narrative"

export function findFormat(name: string | null | undefined): DictationFormat | null {
  if (!name) return null
  return DICTATION_FORMATS.find((format) => format.name === name) ?? null
}

/** Resolves a format name to a real format, falling back to the default rather than throwing — a
 * model hallucinating a format name outside the registry must degrade to something reasonable, not
 * break report drafting. Mirrors the "never break, only narrow" contract of lib/query-router.ts and
 * lib/dictation/router.ts. */
export function resolveFormat(name: string | null | undefined): DictationFormat {
  return findFormat(name) ?? DICTATION_FORMATS.find((format) => format.name === DEFAULT_FORMAT_NAME)!
}
