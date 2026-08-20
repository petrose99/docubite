import { PATHOLOGY_TEMPLATES } from "@/lib/domains/pathology"
import type { DocumentFieldDefinition } from "@/lib/document-templates"
import { parseTemplateFields } from "@/lib/document-templates"
import type { NarrativeSection } from "@/lib/report-render/narrative"
import type { SynopticField } from "@/lib/report-render/synoptic"

/** The built-in report templates a workspace starts with.
 *
 * A ReportTemplate is the *output* format — which slots the synoptic block has and which prose
 * sections follow it. That is a different thing from the extraction template (lib/domains), which
 * says what to pull out of the dictation. Both existed before this file; nothing created either.
 *
 * The synoptic slots are DERIVED from the domain pack rather than retyped here. renderSynoptic
 * looks values up by `key`, so a slot whose key does not exist in the extraction schema renders
 * `[missing: …]` forever and nobody can tell whether the field was never dictated or the template
 * simply names a field that cannot exist. Deriving makes that class of drift unrepresentable. */

/** Fields excluded from the synoptic block. `patient_id` was pathology's direct identifier — kept
 * as a mechanism (a future hard-coded pack can populate it again) but empty now that the default
 * seed is the generic, industry-agnostic template and has no identifier field of its own to name. */
const SUPPRESSED_SLOTS = new Set<string>([])

/** Units for slots where the extraction schema stores a bare number. Keyed by field key, so adding
 * a measured field to the domain pack without a unit here renders the number alone rather than
 * silently attaching the wrong one. */
const SLOT_UNITS: Record<string, string> = {}

/** Derives synoptic slots from an extraction template's fields, preserving the pack's order and
 * its `required` flags — a field the extraction schema calls required is a slot whose absence the
 * pre-sign-off checklist must raise. */
export function deriveSynopticFields(fields: DocumentFieldDefinition[]): SynopticField[] {
  return fields
    .filter((field) => !SUPPRESSED_SLOTS.has(field.key))
    .map((field) => ({
      key: field.key,
      label: field.label,
      required: Boolean(field.required),
      ...(SLOT_UNITS[field.key] ? { unit: SLOT_UNITS[field.key] } : {}),
    }))
}

/** The prose half of a pathology report.
 *
 * Deliberately three sections and no more. Each instruction is a scope limit rather than a writing
 * brief: renderNarrative is already told never to invent, and a section described in terms of what
 * it should contain ("a summary of the case") invites exactly the synthesis this must not do. */
const PATHOLOGY_NARRATIVE_SECTIONS: NarrativeSection[] = [
  {
    key: "clinical_history",
    title: "Clinical history",
    instruction: "The history and clinical indication as dictated. Do not add history from any other source.",
  },
  {
    key: "gross_description",
    title: "Gross description",
    instruction: "The specimen as received and described aloud: measurements, colour, consistency, sectioning, blocks submitted.",
  },
  {
    key: "microscopic_description",
    title: "Microscopic description",
    instruction: "The histological findings as dictated. Do not restate the diagnosis; it is rendered in the synoptic block above.",
  },
  {
    key: "comment",
    title: "Comment",
    instruction: "Any comment, correlation, or recommendation the speaker made. Empty is the normal case.",
  },
]

export type ReportTemplateSeed = {
  name: string
  /** Null means the workspace-wide fallback, which is what findReportTemplate falls back to when
   * no template matches the dictated specimen type. */
  specimenType: string | null
  /** The extraction template these slots were derived from, so the pairing is visible at the seam. */
  documentTemplateCode: string
  synopticFields: SynopticField[]
  narrativeSections: NarrativeSection[]
}

/** The prose half of a generic report — two sections rather than pathology's four, since a
 * general-purpose dictation has no fixed clinical structure to describe. */
const GENERAL_NARRATIVE_SECTIONS: NarrativeSection[] = [
  {
    key: "summary",
    title: "Summary",
    instruction: "A concise summary of what was dictated. Do not add anything not actually said.",
  },
  {
    key: "details",
    title: "Details",
    instruction: "Any further detail, observation, or note the speaker made that belongs in the body rather than the summary.",
  },
]

/** ensureWorkspaceReportTemplates upserts by name and never overwrites an existing row (see
 * models/report-templates.ts), so a workspace that already has a pathology report template from
 * before this change keeps it untouched — this list only decides what a workspace gets when it has
 * NOTHING yet. Pathology's template seed is deliberately not listed here any more: it remains
 * addressable (findReportTemplate can still be pointed at a pathology-specimen row directly, and
 * the pack itself is unwired, not deleted, from lib/domains/index.ts), it just is not what a new
 * workspace starts with. */
export const DEFAULT_REPORT_TEMPLATES: ReportTemplateSeed[] = [
  {
    name: "General report",
    specimenType: null,
    documentTemplateCode: "general_report",
    // Empty means "derive from the document's own fields at draft time" (deriveSynopticFields,
    // called from createReportDraft) rather than a fixed slot list — the whole point of a template
    // with no predetermined schema.
    synopticFields: [],
    narrativeSections: GENERAL_NARRATIVE_SECTIONS,
  },
]

/** Kept for the pathology pack, which is unwired but not deleted (lib/domains/index.ts) — a
 * workspace that wants to opt back into structured pathology reporting can still be pointed at
 * this seed directly; it is simply no longer part of DEFAULT_REPORT_TEMPLATES. */
export const PATHOLOGY_REPORT_TEMPLATE: ReportTemplateSeed = {
  name: PATHOLOGY_TEMPLATES[0].name,
  specimenType: null,
  documentTemplateCode: PATHOLOGY_TEMPLATES[0].code,
  synopticFields: deriveSynopticFields(parseTemplateFields(PATHOLOGY_TEMPLATES[0].fields)),
  narrativeSections: PATHOLOGY_NARRATIVE_SECTIONS,
}
