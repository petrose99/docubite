import type { AsrSegment } from "@/lib/asr/types"
import type { DocumentFieldDefinition, FieldProvenanceHints } from "@/lib/document-templates"
import { scoreMatch } from "@/lib/provenance"

/** Audio provenance: the same idea as lib/provenance, with a time span where a page rectangle
 * would be.
 *
 * A dictated value has no bounding box — there is nothing to draw a rectangle on. What it does have
 * is a moment: "the grade was said at 1:12". Resolving that lets a reviewer play the three seconds
 * the value came from instead of taking the transcript's word for it, which is the same audit
 * property the PDF highlight provides.
 *
 * Deliberately reuses scoreMatch from lib/provenance rather than reimplementing matching, so the
 * document and audio paths agree on what "this quote matches this text" means, and a change to that
 * definition cannot drift between them. */

/** Where a value was said. `score` records match quality so a weak pin can be shown as approximate,
 * exactly as the document Ref's score is used. */
export type AudioRef = {
  startMs: number
  endMs: number
  quote: string
  /** Index into the transcript's segment list, or null when the pin spans a merged window. */
  segmentIndex: number | null
  score: number
}

export type AudioProvenance = {
  version: 1
  fields: Record<string, AudioRef>
  items: Record<string, (AudioRef | null)[]>
}

/** The same acceptance bar as the document resolver: below it the value is not pinned at all
 * rather than pinned somewhere plausible-looking but wrong. */
const ACCEPT_SCORE = 0.55

/** Segments are short — often a single clause — so a value and the words around it can straddle
 * two of them. Candidate windows are single segments plus adjacent pairs, which catches that
 * without letting a window grow big enough to be meaningless. */
function candidateWindows(segments: AsrSegment[]): { startMs: number; endMs: number; text: string; index: number | null }[] {
  const windows: { startMs: number; endMs: number; text: string; index: number | null }[] =
    segments.map((segment, index) => ({ startMs: segment.startMs, endMs: segment.endMs, text: segment.text, index }))
  for (let i = 0; i + 1 < segments.length; i++) {
    windows.push({ startMs: segments[i].startMs, endMs: segments[i + 1].endMs, text: `${segments[i].text} ${segments[i + 1].text}`, index: null })
  }
  return windows
}

/** Best-matching window for one query string, or null if nothing clears ACCEPT_SCORE.
 *
 * Ties break towards the SHORTER window: a single segment that matches as well as a merged pair is
 * the more precise citation, and precision is the entire point of pinning a timestamp. */
export function resolveAudioRef(query: string, segments: AsrSegment[]): AudioRef | null {
  if (!query.trim() || !segments.length) return null
  let best: AudioRef | null = null
  for (const window of candidateWindows(segments)) {
    const score = scoreMatch(query, window.text)
    if (score < ACCEPT_SCORE) continue
    const duration = window.endMs - window.startMs
    if (best && (score < best.score || (score === best.score && duration >= best.endMs - best.startMs))) continue
    best = { startMs: window.startMs, endMs: window.endMs, quote: window.text.slice(0, 120), segmentIndex: window.index, score: Math.round(score * 100) / 100 }
  }
  return best
}

/** Flattens an extracted value to a string to match against, for when the model's quote hint is
 * missing or paraphrased — the value as spoken is usually the most reliable thing to look for. */
function valueToQuery(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map(valueToQuery).filter(Boolean).join(" ")
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).map(valueToQuery).filter(Boolean).join(" ")
  return ""
}

/** Resolves every extracted field to a time span in the transcript.
 *
 * Mirrors buildDocumentProvenance's contract exactly: scalars under `fields`, array rows under
 * `items` index-aligned with the extracted rows (a row that could not be pinned is a null slot, not
 * a missing entry), and a field that resolves to nothing is simply absent. */
export function buildAudioProvenance(
  fields: DocumentFieldDefinition[],
  hints: FieldProvenanceHints,
  values: Record<string, unknown>,
  segments: AsrSegment[],
): AudioProvenance {
  const provenance: AudioProvenance = { version: 1, fields: {}, items: {} }
  if (!segments.length) return provenance

  for (const field of fields) {
    const value = values[field.key]
    if (value === undefined || value === null || value === "") continue

    if (field.type === "array") {
      if (!Array.isArray(value)) continue
      const rowHints = hints.items[field.key] ?? []
      const refs = value.map((row, index) => {
        // The quote hint is tried first, the row's own values second — the same two-step the
        // document resolver uses, for the same reason: a paraphrased hint should degrade to
        // matching on the value rather than to no pin at all.
        const quote = rowHints[index]?.quote ?? ""
        return resolveAudioRef(quote, segments) ?? resolveAudioRef(valueToQuery(row), segments)
      })
      if (refs.some(Boolean)) provenance.items[field.key] = refs
      continue
    }

    const quote = hints.fields[field.key]?.quote ?? ""
    const ref = resolveAudioRef(quote, segments) ?? resolveAudioRef(valueToQuery(value), segments)
    if (ref) provenance.fields[field.key] = ref
  }
  return provenance
}

/** Formats a span as m:ss–m:ss for display next to a value. */
export function formatAudioSpan(ref: Pick<AudioRef, "startMs" | "endMs">): string {
  const stamp = (ms: number) => {
    const total = Math.floor(ms / 1000)
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
  }
  return ref.endMs > ref.startMs ? `${stamp(ref.startMs)}–${stamp(ref.endMs)}` : stamp(ref.startMs)
}
