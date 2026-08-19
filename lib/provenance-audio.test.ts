import type { AsrSegment } from "@/lib/asr/types"
import { parseTemplateFields } from "@/lib/document-templates"
import { buildAudioProvenance, formatAudioSpan, resolveAudioRef } from "@/lib/provenance-audio"
import { describe, expect, it } from "vitest"

const segments: AsrSegment[] = [
  { startMs: 0, endMs: 4000, text: "Specimen is a core biopsy of the left breast" },
  { startMs: 4000, endMs: 9000, text: "Diagnosis invasive ductal carcinoma" },
  { startMs: 9000, endMs: 14000, text: "Nottingham grade two" },
  { startMs: 14000, endMs: 20000, text: "ER positive ninety percent" },
]

const fields = parseTemplateFields([
  { key: "diagnosis", label: "Diagnosis", type: "string", instruction: "", required: true },
  { key: "grade", label: "Grade", type: "string", instruction: "", required: false },
  { key: "absent", label: "Absent", type: "string", instruction: "", required: false },
  { key: "ihc_markers", label: "IHC", type: "array", instruction: "", required: false, itemFields: [
    { key: "name", label: "Marker", type: "string", instruction: "", required: false },
    { key: "result", label: "Result", type: "string", instruction: "", required: false },
  ] },
])

const noHints = { fields: {}, items: {} }

describe("resolveAudioRef", () => {
  it("pins a quote to the segment that contains it", () => {
    const ref = resolveAudioRef("invasive ductal carcinoma", segments)
    expect(ref?.startMs).toBe(4000)
    expect(ref?.endMs).toBe(9000)
    expect(ref?.score).toBe(1)
  })

  it("returns null when nothing clears the acceptance bar, rather than a plausible wrong pin", () => {
    expect(resolveAudioRef("pulmonary embolism unrelated text entirely", segments)).toBeNull()
    expect(resolveAudioRef("", segments)).toBeNull()
    expect(resolveAudioRef("anything", [])).toBeNull()
  })

  it("prefers the shorter window when a single segment matches as well as a merged pair", () => {
    // Precision is the point of a timestamp: a 5s citation beats an 11s one at equal score.
    const ref = resolveAudioRef("Nottingham grade two", segments)
    expect(ref?.startMs).toBe(9000)
    expect(ref?.endMs).toBe(14000)
  })

  it("can span two adjacent segments when the value straddles them", () => {
    const split: AsrSegment[] = [
      { startMs: 0, endMs: 1000, text: "the final diagnosis is invasive" },
      { startMs: 1000, endMs: 2000, text: "ductal carcinoma grade three" },
    ]
    const ref = resolveAudioRef("invasive ductal carcinoma", split)
    expect(ref).not.toBeNull()
    expect(ref!.startMs).toBe(0)
    expect(ref!.endMs).toBe(2000)
  })
})

describe("buildAudioProvenance", () => {
  it("pins scalar fields by their value when no quote hint is given", () => {
    const provenance = buildAudioProvenance(fields, noHints, { diagnosis: "invasive ductal carcinoma", grade: "Nottingham grade two" }, segments)
    expect(provenance.fields.diagnosis.startMs).toBe(4000)
    expect(provenance.fields.grade.startMs).toBe(9000)
  })

  it("cannot pin a normalised numeral by value alone, and declines rather than guessing", () => {
    // A KNOWN LIMITATION, asserted so it stays visible: the speaker says "grade two", the
    // structuring step correctly normalises it to "2", and the two no longer share enough words to
    // match. Numeric and date fields therefore depend on the model's _provenance quote hint for
    // their timestamp; without one they end up unpinned. Unpinned is the right failure — pinning
    // "2" to whichever segment happened to score highest would cite the wrong moment.
    const byValue = buildAudioProvenance(fields, noHints, { grade: "2" }, segments)
    expect(byValue.fields.grade).toBeUndefined()

    const withHint = buildAudioProvenance(fields, { fields: { grade: { page: null, quote: "Nottingham grade two" } }, items: {} }, { grade: "2" }, segments)
    expect(withHint.fields.grade.startMs).toBe(9000)
  })

  it("prefers the model's quote hint over the raw value", () => {
    const hints = { fields: { diagnosis: { page: null, quote: "Nottingham grade two" } }, items: {} }
    const provenance = buildAudioProvenance(fields, hints, { diagnosis: "invasive ductal carcinoma" }, segments)
    expect(provenance.fields.diagnosis.startMs).toBe(9000)
  })

  it("falls back to the value when the quote hint matches nothing", () => {
    const hints = { fields: { diagnosis: { page: null, quote: "completely unrelated wording here" } }, items: {} }
    const provenance = buildAudioProvenance(fields, hints, { diagnosis: "invasive ductal carcinoma" }, segments)
    expect(provenance.fields.diagnosis.startMs).toBe(4000)
  })

  it("omits a field that cannot be pinned instead of guessing", () => {
    const provenance = buildAudioProvenance(fields, noHints, { absent: "never spoken aloud at all" }, segments)
    expect(provenance.fields.absent).toBeUndefined()
  })

  it("keeps array rows index-aligned, with a null slot for an unpinnable row", () => {
    const provenance = buildAudioProvenance(fields, noHints, {
      ihc_markers: [{ name: "ER", result: "positive ninety percent" }, { name: "XYZ", result: "not mentioned anywhere" }],
    }, segments)
    expect(provenance.items.ihc_markers).toHaveLength(2)
    expect(provenance.items.ihc_markers[0]?.startMs).toBe(14000)
    expect(provenance.items.ihc_markers[1]).toBeNull()
  })

  it("returns an empty record when the transcript has no segments", () => {
    expect(buildAudioProvenance(fields, noHints, { diagnosis: "invasive ductal carcinoma" }, [])).toEqual({ version: 1, fields: {}, items: {} })
  })
})

describe("formatAudioSpan", () => {
  it("formats a span as m:ss–m:ss and a point as m:ss", () => {
    expect(formatAudioSpan({ startMs: 72_000, endMs: 95_000 })).toBe("1:12–1:35")
    expect(formatAudioSpan({ startMs: 5_000, endMs: 5_000 })).toBe("0:05")
  })
})
