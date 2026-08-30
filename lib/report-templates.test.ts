import { parseTemplateFields } from "@/lib/document-templates"
import { FINANCE_TEMPLATES } from "@/lib/domains/finance"
import { deriveSynopticFields, DEFAULT_REPORT_TEMPLATES } from "@/lib/report-templates"
import { parseNarrativeSections } from "@/lib/report-render/narrative"
import { parseSynopticFields } from "@/lib/report-render/synoptic"
import { describe, expect, it } from "vitest"

const financeFields = parseTemplateFields(FINANCE_TEMPLATES[0].fields)

describe("deriveSynopticFields", () => {
  it("keeps the pack's order and its required flags", () => {
    const slots = deriveSynopticFields(financeFields)
    expect(slots.map((slot) => slot.key)).toEqual(financeFields.map((field) => field.key))
    expect(slots.map((slot) => slot.required)).toEqual(financeFields.map((field) => Boolean(field.required)))
  })

  /** The reason this file derives rather than retypes. renderSynoptic looks values up by key, so a
   * slot naming a key the extraction schema does not produce renders [missing: …] forever and
   * nothing on screen explains why. */
  it("names only keys the extraction schema can actually produce", () => {
    const keys = new Set(financeFields.map((field) => field.key))
    for (const slot of deriveSynopticFields(financeFields)) expect(keys.has(slot.key)).toBe(true)
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

  // The default seed is the generic report, with no fixed slot list — an empty synopticFields
  // means "derive from the document at draft time" (models/report-drafts.ts), not "no slots ever".
  it("ships with no fixed synoptic slots, since it has no predetermined schema", () => {
    expect(DEFAULT_REPORT_TEMPLATES[0].synopticFields).toEqual([])
  })
})
