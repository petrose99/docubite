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

/** Fields excluded from the synoptic block. Not "unimportant" — `patient_id` is a direct
 * identifier, and repeating it inside the report body is a disclosure the header already makes. */
const SUPPRESSED_SLOTS = new Set(["patient_id"])

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

const pathology = PATHOLOGY_TEMPLATES[0]

export const DEFAULT_REPORT_TEMPLATES: ReportTemplateSeed[] = [
  {
    name: pathology.name,
    specimenType: null,
    documentTemplateCode: pathology.code,
    synopticFields: deriveSynopticFields(parseTemplateFields(pathology.fields)),
    narrativeSections: PATHOLOGY_NARRATIVE_SECTIONS,
  },
]
