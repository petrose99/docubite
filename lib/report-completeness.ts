import { NOT_DICTATED } from "@/lib/report-render/narrative"
import { MISSING_MARKER, type SynopticRender } from "@/lib/report-render/synoptic"

/** The pre-sign-off checklist: what the dictation did not cover.
 *
 * Sign-off is the moment a draft becomes a clinical document, so the question this answers is not
 * "did generation succeed" but "is a person about to sign something with holes in it". It reports
 * gaps; it does not fill them, and it does not block — a pathologist may legitimately sign a report
 * where an optional section was never dictated. What it must never do is let a gap go unseen. */

export type CompletenessReport = {
  /** Required synoptic slots with no dictated value. These are the ones that matter. */
  missingRequired: string[]
  /** Optional slots with no value — informational. */
  missingOptional: string[]
  /** Narrative sections the dictation never covered. */
  emptySections: string[]
  /** Sections containing an [unclear] marker, i.e. audio the ASR could not resolve. */
  unclearSections: string[]
  /** True when nothing is missing and nothing is unclear. */
  complete: boolean
}

/** Marker the narrative uses for audio it could not make out. Kept here rather than imported from
 * the prompt so a prompt reword cannot silently stop this check finding anything. */
const UNCLEAR_MARKER = "[unclear]"

export function buildCompletenessReport(synoptic: SynopticRender, narrative: Record<string, string>, sectionTitles: Record<string, string> = {}): CompletenessReport {
  const missingRequired = synoptic.missingRequired
  const missingOptional = synoptic.lines.filter((line) => line.missing && !line.required).map((line) => line.label)
  const title = (key: string) => sectionTitles[key] ?? key

  const emptySections: string[] = []
  const unclearSections: string[] = []
  for (const [key, text] of Object.entries(narrative)) {
    if (text.trim() === NOT_DICTATED) emptySections.push(title(key))
    if (text.includes(UNCLEAR_MARKER)) unclearSections.push(title(key))
  }

  return {
    missingRequired,
    missingOptional,
    emptySections,
    unclearSections,
    complete: !missingRequired.length && !emptySections.length && !unclearSections.length,
  }
}

/** Human-readable summary for the sign-off dialog. Leads with required gaps because that is the
 * decision the signer is actually making. */
export function describeCompleteness(report: CompletenessReport): string {
  if (report.complete) return "Every templated field was dictated and nothing was marked unclear."
  const parts: string[] = []
  if (report.missingRequired.length) parts.push(`${report.missingRequired.length} required field(s) not dictated: ${report.missingRequired.join(", ")}`)
  if (report.unclearSections.length) parts.push(`unclear audio in: ${report.unclearSections.join(", ")}`)
  if (report.emptySections.length) parts.push(`sections not dictated: ${report.emptySections.join(", ")}`)
  if (report.missingOptional.length) parts.push(`${report.missingOptional.length} optional field(s) not dictated`)
  return parts.join("; ")
}

/** Counts the visible [missing: …] markers in rendered text. A cross-check on the renderer: if a
 * required slot were ever dropped instead of marked, this and missingRequired would disagree. */
export function countMissingMarkers(renderedText: string, labels: string[]): number {
  return labels.filter((label) => renderedText.includes(MISSING_MARKER(label))).length
}
