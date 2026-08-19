import { parseTemplateFields } from "@/lib/document-templates"
import { PATHOLOGY_TEMPLATES } from "@/lib/domains/pathology"
import { deriveSynopticFields, DEFAULT_REPORT_TEMPLATES } from "@/lib/report-templates"
import { parseNarrativeSections } from "@/lib/report-render/narrative"
import { parseSynopticFields, renderSynoptic } from "@/lib/report-render/synoptic"
import { describe, expect, it } from "vitest"

const pathologyFields = parseTemplateFields(PATHOLOGY_TEMPLATES[0].fields)

describe("deriveSynopticFields", () => {
  it("keeps the pack's order and its required flags", () => {
    const slots = deriveSynopticFields(pathologyFields)
    const expected = pathologyFields.filter((field) => field.key !== "patient_id")
    expect(slots.map((slot) => slot.key)).toEqual(expected.map((field) => field.key))
    expect(slots.map((slot) => slot.required)).toEqual(expected.map((field) => Boolean(field.required)))
  })

  it("suppresses the direct patient identifier", () => {
    expect(deriveSynopticFields(pathologyFields).map((slot) => slot.key)).not.toContain("patient_id")
  })

  /** The reason this file derives rather than retypes. renderSynoptic looks values up by key, so a
   * slot naming a key the extraction schema does not produce renders [missing: …] forever and
   * nothing on screen explains why. */
  it("names only keys the extraction schema can actually produce", () => {
    const keys = new Set(pathologyFields.map((field) => field.key))
    for (const slot of deriveSynopticFields(pathologyFields)) expect(keys.has(slot.key)).toBe(true)
  })
})

describe("DEFAULT_REPORT_TEMPLATES", () => {
  it("parses through the same schemas the renderer uses", () => {
    for (const seed of DEFAULT_REPORT_TEMPLATES) {
      expect(() => parseSynopticFields(seed.synopticFields)).not.toThrow()
      expect(() => parseNarrativeSections(seed.narrativeSections)).not.toThrow()
    }
  })

  it("ships a workspace fallback, which is what findReportTemplate looks for", () => {
    expect(DEFAULT_REPORT_TEMPLATES.some((seed) => seed.specimenType === null)).toBe(true)
  })

  it("renders a required slot with no value as a visible marker rather than dropping it", () => {
    const seed = DEFAULT_REPORT_TEMPLATES[0]
    const render = renderSynoptic(seed.synopticFields, { diagnosis: "Invasive ductal carcinoma" })
    expect(render.text).toContain("[missing: Accession number]")
    expect(render.missingRequired).toContain("Accession number")
    // An optional slot with nothing dictated is dropped; a required one never is.
    expect(render.text).not.toContain("Grade")
  })
})
