import { describe, expect, it } from "vitest"
import { deriveSheet, type DerivableDocument } from "@/lib/sheet-derive"
import type { DocumentFieldDefinition } from "@/lib/document-templates"

const fields = [
  { key: "vendor", label: "Supplier", type: "string", instruction: "", required: true },
  { key: "total", label: "Total", type: "number", instruction: "", required: true },
  {
    key: "line_items", label: "Line items", type: "array", instruction: "", required: false,
    itemFields: [
      { key: "description", label: "Description", type: "string", instruction: "", required: false },
      { key: "amount", label: "Amount", type: "number", instruction: "", required: false },
    ],
  },
] as unknown as DocumentFieldDefinition[]

const document = (overrides: Partial<DerivableDocument> = {}): DerivableDocument => ({
  id: "doc-1",
  filename: "invoice.pdf",
  reviewedData: null,
  rawExtraction: {
    vendor: "Northstar Ltd",
    total: 2840,
    line_items: [{ description: "Consulting", amount: 2000 }, { description: "Hosting", amount: 840 }],
  },
  confidence: null,
  ...overrides,
})

describe("deriveSheet", () => {
  it("expands the line-item table into one row per item, repeating the document's own fields", () => {
    const { columns, rows, multiRow } = deriveSheet(fields, [document()], { multiRow: true })

    expect(multiRow).toBe(true)
    expect(columns.map((column) => column.id)).toEqual(["vendor", "total", "item_description", "item_amount"])
    expect(rows).toHaveLength(2)
    expect(rows[0].values).toMatchObject({ vendor: "Northstar Ltd", total: 2840, item_description: "Consulting", item_amount: 2000 })
    expect(rows[1].values).toMatchObject({ vendor: "Northstar Ltd", total: 2840, item_description: "Hosting", item_amount: 840 })
    expect(rows.map((row) => row.itemIndex)).toEqual([0, 1])
  })

  it("gives one row per document, and a summary column for the array, when not in multi-row mode", () => {
    const { columns, rows, multiRow } = deriveSheet(fields, [document()], { multiRow: false })

    expect(multiRow).toBe(false)
    expect(columns.map((column) => column.id)).toEqual(["vendor", "total", "line_items"])
    expect(rows).toHaveLength(1)
    expect(rows[0].itemIndex).toBeNull()
  })

  it("prefers what a human reviewed over what the model first extracted", () => {
    const { rows } = deriveSheet(fields, [document({ reviewedData: { vendor: "Northstar Limited", total: 2840, line_items: [] } })], { multiRow: true })

    expect(rows[0].values.vendor).toBe("Northstar Limited")
  })

  it("carries confidence and missing-required flags through to the row", () => {
    const { rows } = deriveSheet(fields, [document({ confidence: { fieldConfidence: { vendor: 0.4 }, missingRequiredFields: ["total"] } })], { multiRow: false })

    expect(rows[0].fieldConfidence).toEqual({ vendor: 0.4 })
    expect(rows[0].missingRequired).toEqual(["total"])
  })

  it("still produces a row for a document whose line items came back empty", () => {
    const { rows } = deriveSheet(fields, [document({ rawExtraction: { vendor: "Northstar Ltd", total: 0, line_items: [] } })], { multiRow: true })

    expect(rows).toHaveLength(1)
    expect(rows[0].values.vendor).toBe("Northstar Ltd")
  })
})
