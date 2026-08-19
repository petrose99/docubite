import { buildCompletenessReport, countMissingMarkers, describeCompleteness } from "@/lib/report-completeness"
import { NOT_DICTATED } from "@/lib/report-render/narrative"
import { MISSING_MARKER, formatSynopticValue, parseSynopticFields, renderSynoptic } from "@/lib/report-render/synoptic"
import { describe, expect, it } from "vitest"

const fields = parseSynopticFields([
  { key: "diagnosis", label: "Diagnosis", required: true },
  { key: "grade", label: "Grade", required: true },
  { key: "margin_status", label: "Margins", required: false },
  { key: "tumour_size", label: "Tumour size", required: false, unit: "mm" },
  { key: "ihc_markers", label: "IHC", required: false },
])

describe("renderSynoptic", () => {
  it("renders in TEMPLATE order and ignores values the template does not name", () => {
    const render = renderSynoptic(fields, { grade: "2", diagnosis: "IDC", patient_ssn: "should never appear" })
    expect(render.lines.map((line) => line.key)).toEqual(["diagnosis", "grade", "margin_status", "tumour_size", "ihc_markers"])
    expect(render.text).not.toContain("should never appear")
    expect(render.text).not.toContain("patient_ssn")
  })

  it("marks a missing REQUIRED slot visibly and never drops it", () => {
    const render = renderSynoptic(fields, { diagnosis: "IDC" })
    expect(render.text).toContain(`Grade: ${MISSING_MARKER("Grade")}`)
    expect(render.missingRequired).toEqual(["Grade"])
  })

  it("invents nothing — no value appears that was not supplied", () => {
    const render = renderSynoptic(fields, { diagnosis: "IDC", grade: "2" })
    // Optional empty slots are omitted; required empty slots are marked. Nothing is filled in.
    expect(render.text).toBe("Diagnosis: IDC\nGrade: 2")
    expect(render.lines.filter((line) => line.value !== null)).toHaveLength(2)
  })

  it("appends a unit only where the template declares one", () => {
    const render = renderSynoptic(fields, { diagnosis: "IDC", grade: "2", tumour_size: 14 })
    expect(render.text).toContain("Tumour size: 14 mm")
  })

  it("drops an optional empty slot but keeps a required one", () => {
    const render = renderSynoptic(fields, { diagnosis: "IDC" })
    expect(render.text).not.toContain("Margins")
    expect(render.text).toContain("Grade")
  })
})

describe("formatSynopticValue", () => {
  it("renders repeated rows as readable clauses without summarising them", () => {
    expect(formatSynopticValue([{ name: "ER", result: "positive", percent_positive: 90 }, { name: "HER2", result: "negative" }]))
      .toBe("ER: positive, 90; HER2: negative")
  })

  it("treats empty, null and undefined as no value", () => {
    for (const value of ["", null, undefined, []]) expect(formatSynopticValue(value)).toBeNull()
  })

  it("renders booleans and numbers without losing a legitimate zero or false", () => {
    expect(formatSynopticValue(false)).toBe("No")
    expect(formatSynopticValue(0)).toBe("0")
  })
})

describe("buildCompletenessReport", () => {
  const titles = { gross: "Gross description", micro: "Microscopic" }

  it("separates required gaps from optional ones and finds unclear audio", () => {
    const synoptic = renderSynoptic(fields, { diagnosis: "IDC" })
    const report = buildCompletenessReport(synoptic, { gross: "Received fresh, [unclear] grams", micro: NOT_DICTATED }, titles)
    expect(report.missingRequired).toEqual(["Grade"])
    expect(report.missingOptional).toEqual(["Margins", "Tumour size", "IHC"])
    expect(report.emptySections).toEqual(["Microscopic"])
    expect(report.unclearSections).toEqual(["Gross description"])
    expect(report.complete).toBe(false)
  })

  it("is complete only when nothing is missing and nothing is unclear", () => {
    const synoptic = renderSynoptic(parseSynopticFields([{ key: "diagnosis", label: "Diagnosis", required: true }]), { diagnosis: "IDC" })
    const report = buildCompletenessReport(synoptic, { gross: "Received fresh." }, titles)
    expect(report.complete).toBe(true)
    expect(describeCompleteness(report)).toContain("Every templated field")
  })

  it("leads its summary with the required gaps", () => {
    const synoptic = renderSynoptic(fields, {})
    const report = buildCompletenessReport(synoptic, {}, titles)
    expect(describeCompleteness(report).startsWith("2 required field(s) not dictated")).toBe(true)
  })

  it("cross-checks that every required gap actually rendered a visible marker", () => {
    const synoptic = renderSynoptic(fields, {})
    expect(countMissingMarkers(synoptic.text, synoptic.missingRequired)).toBe(synoptic.missingRequired.length)
  })
})
