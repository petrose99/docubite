import { parseTemplateFields } from "@/lib/document-templates"
import { projectDocumentFields } from "@/lib/field-projection"
import { FINANCE_OPTIONAL_TEMPLATES } from "@/lib/domains/finance"
import type { DocumentProvenance, Ref } from "@/lib/provenance"
import { describe, expect, it } from "vitest"

const fields = parseTemplateFields([
  { key: "vendor", label: "Supplier", type: "string", instruction: "", required: true },
  { key: "total", label: "Total", type: "number", instruction: "", required: false },
  { key: "issue_date", label: "Issue date", type: "date", instruction: "", required: false },
  { key: "paid", label: "Paid", type: "boolean", instruction: "", required: false },
  { key: "status", label: "Status", type: "enum", instruction: "", required: false, options: ["open", "closed"] },
  { key: "line_items", label: "Line items", type: "array", instruction: "", required: false, itemFields: [
    { key: "description", label: "Description", type: "string", instruction: "", required: false },
    { key: "amount", label: "Amount", type: "number", instruction: "", required: false },
  ] },
])

const ref = (page: number): Ref => ({ page, bbox: [0, 0, 1, 1], quote: `p${page}`, blockIndex: 0, score: 0.9 })

describe("projectDocumentFields", () => {
  it("puts each value in the column its declared type belongs to", () => {
    const rows = projectDocumentFields({
      fields,
      values: { vendor: "Acme Ltd", total: 42.5, issue_date: "2026-03-01", paid: true, status: "open" },
      source: "llm_structured",
    })
    const byKey = Object.fromEntries(rows.map((row) => [row.fieldKey, row]))
    expect(byKey.vendor.valueText).toBe("Acme Ltd")
    expect(byKey.vendor.valueNumber).toBeNull()
    expect(byKey.total.valueNumber).toBe(42.5)
    expect(byKey.total.valueText).toBeNull()
    expect(byKey.paid.valueBool).toBe(true)
    expect(byKey.status.valueText).toBe("open")
    // A date lands in both, so ranges work and the literal printed string survives.
    expect(byKey.issue_date.valueDate).toBe("2026-03-01")
    expect(byKey.issue_date.valueText).toBe("2026-03-01")
  })

  it("emits nothing for absent, empty, or wrongly typed values rather than a wrong row", () => {
    const rows = projectDocumentFields({
      fields,
      values: { vendor: "", total: "forty-two", issue_date: "01/03/2026", paid: "yes", status: "archived" },
      source: "llm_structured",
    })
    expect(rows).toEqual([])
  })

  it("expands array fields to one row per item field per row, carrying row_index", () => {
    const rows = projectDocumentFields({
      fields,
      values: { line_items: [{ description: "Widget", amount: 10 }, { description: "Gadget", amount: 20 }] },
      source: "llm_structured",
    })
    expect(rows).toHaveLength(4)
    expect(rows.map((row) => [row.fieldKey, row.itemKey, row.rowIndex])).toEqual([
      ["line_items", "description", 0], ["line_items", "amount", 0],
      ["line_items", "description", 1], ["line_items", "amount", 1],
    ])
    expect(rows.find((row) => row.itemKey === "amount" && row.rowIndex === 1)?.valueNumber).toBe(20)
  })

  it("keeps scalars distinguishable from array rows (item_key/row_index null)", () => {
    const rows = projectDocumentFields({ fields, values: { vendor: "Acme" }, source: "manual" })
    expect(rows[0].itemKey).toBeNull()
    expect(rows[0].rowIndex).toBeNull()
    expect(rows[0].source).toBe("manual")
  })

  it("attaches per-field confidence and provenance, and inherits both across an array's rows", () => {
    const provenance: DocumentProvenance = { version: 1, fields: { vendor: ref(1) }, items: { line_items: [ref(2), null] } }
    const rows = projectDocumentFields({
      fields,
      values: { vendor: "Acme", line_items: [{ amount: 1 }, { amount: 2 }] },
      confidence: { vendor: 0.42, line_items: 0.8 },
      provenance,
      source: "llm_structured",
    })
    const vendor = rows.find((row) => row.fieldKey === "vendor")!
    expect(vendor.sourceConfidence).toBe(0.42)
    expect(vendor.provenance?.page).toBe(1)
    // Row 0 has a Ref, row 1 explicitly does not — and the array's single score covers both.
    expect(rows.find((row) => row.rowIndex === 0)?.provenance?.page).toBe(2)
    expect(rows.find((row) => row.rowIndex === 1)?.provenance).toBeNull()
    expect(rows.filter((row) => row.fieldKey === "line_items").every((row) => row.sourceConfidence === 0.8)).toBe(true)
  })

  it("leaves confidence and provenance null when the document carries none", () => {
    const rows = projectDocumentFields({ fields, values: { vendor: "Acme" }, source: "llm_structured" })
    expect(rows[0].sourceConfidence).toBeNull()
    expect(rows[0].provenance).toBeNull()
  })

  it("carries audio provenance for a dictation, not just page rectangles", () => {
    // Regression: structureTranscript computed the audio provenance and then passed null here,
    // because the type only admitted page refs — so a dictated value could never be cited to the
    // moment it was spoken.
    const audio = {
      version: 1 as const,
      fields: { vendor: { startMs: 0, endMs: 9600, quote: "I'm from World of Gold", segmentIndex: 0, score: 1 } },
      items: { line_items: [{ startMs: 100, endMs: 900, quote: "one widget", segmentIndex: 1, score: 0.8 }] },
    }
    const rows = projectDocumentFields({
      fields,
      values: { vendor: "World of Gold", line_items: [{ description: "one widget" }] },
      provenance: audio,
      source: "asr",
    })
    const vendor = rows.find((row) => row.fieldKey === "vendor")!
    expect(vendor.provenance).toMatchObject({ startMs: 0, endMs: 9600 })
    expect(rows.find((row) => row.rowIndex === 0)?.provenance).toMatchObject({ startMs: 100, endMs: 900 })
  })

  it("works unchanged on a different domain's template — the adapter is data, not code", () => {
    const bankStatementFields = parseTemplateFields(FINANCE_OPTIONAL_TEMPLATES[0].fields)
    const rows = projectDocumentFields({
      fields: bankStatementFields,
      values: {
        account_holder: "Acme Ltd", account_number: "12345678", currency_code: "GBP",
        opening_balance: 100, closing_balance: 250,
        transactions: [{ description: "Deposit", credit: 150 }],
      },
      source: "asr",
    })
    const byKey = Object.fromEntries(rows.filter((row) => !row.itemKey).map((row) => [row.fieldKey, row]))
    expect(byKey.account_holder.valueText).toBe("Acme Ltd")
    expect(byKey.closing_balance.valueNumber).toBe(250)
    // The transaction field is filterable in its own right, not buried in prose.
    expect(rows.find((row) => row.itemKey === "description")?.valueText).toBe("Deposit")
    expect(rows.find((row) => row.itemKey === "credit")?.valueNumber).toBe(150)
    expect(rows.every((row) => row.source === "asr")).toBe(true)
  })
})
