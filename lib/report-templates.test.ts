import { parseTemplateFields } from "@/lib/document-templates"
import { PATHOLOGY_TEMPLATES } from "@/lib/domains/pathology"
import { deriveSynopticFields, DEFAULT_REPORT_TEMPLATES, PATHOLOGY_REPORT_TEMPLATE } from "@/lib/report-templates"
import { parseNarrativeSections } from "@/lib/report-render/narrative"
import { parseSynopticFields, renderSynoptic } from "@/lib/report-render/synoptic"
import { describe, expect, it } from "vitest"

const pathologyFields = parseTemplateFields(PATHOLOGY_TEMPLATES[0].fields)

describe("deriveSynopticFields", () => {
  it("keeps the pack's order and its required flags", () => {
    const slots = deriveSynopticFields(pathologyFields)
    expect(slots.map((slot) => slot.key)).toEqual(pathologyFields.map((field) => field.key))
    expect(slots.map((slot) => slot.required)).toEqual(pathologyFields.map((field) => Boolean(field.required)))
  })

  // SUPPRESSED_SLOTS is now empty (lib/report-templates.ts) — it used to hide patient_id, which
  // was pathology-specific. The mechanism stays (a future hard-coded pack can populate it again for
  // its own identifier field) but derivation itself is generic and suppresses nothing.
  it("suppresses nothing by default — SUPPRESSED_SLOTS is empty until a pack opts a key back in", () => {
    expect(deriveSynopticFields(pathologyFields).map((slot) => slot.key)).toContain("patient_id")
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
    for (const seed of [...DEFAULT_REPORT_TEMPLATES, PATHOLOGY_REPORT_TEMPLATE]) {
      expect(() => parseSynopticFields(seed.synopticFields)).not.toThrow()
      expect(() => parseNarrativeSections(seed.narrativeSections)).not.toThrow()
    }
  })

  it("ships a workspace fallback, which is what findReportTemplate looks for", () => {
    expect(DEFAULT_REPORT_TEMPLATES.some((seed) => seed.specimenType === null)).toBe(true)
  })

  // The default seed is now the generic report, with no fixed slot list — an empty synopticFields
  // means "derive from the document at draft time" (models/report-drafts.ts), not "no slots ever".
  it("ships with no fixed synoptic slots, since it has no predetermined schema", () => {
    expect(DEFAULT_REPORT_TEMPLATES[0].synopticFields).toEqual([])
  })
})

describe("PATHOLOGY_REPORT_TEMPLATE", () => {
  it("renders a required slot with no value as a visible marker rather than dropping it", () => {
    const render = renderSynoptic(PATHOLOGY_REPORT_TEMPLATE.synopticFields, { diagnosis: "Invasive ductal carcinoma" })
    expect(render.text).toContain("[missing: Accession number]")
    expect(render.missingRequired).toContain("Accession number")
    // An optional slot with nothing dictated is dropped; a required one never is.
    expect(render.text).not.toContain("Grade")
  })

  it("is kept but no longer seeded by default — the pack is unwired, not deleted", () => {
    expect(DEFAULT_REPORT_TEMPLATES.some((seed) => seed.name === PATHOLOGY_REPORT_TEMPLATE.name)).toBe(false)
  })
})
