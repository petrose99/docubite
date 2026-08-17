import { flattenDocumentValues, MAX_FIELD_VALUE_ROWS } from "@/lib/document-values"
import { DEFAULT_DOCUMENT_TEMPLATES, parseTemplateFields, type DocumentFieldDefinition } from "@/lib/document-templates"
import { describe, expect, it } from "vitest"

const invoiceFields = parseTemplateFields(DEFAULT_DOCUMENT_TEMPLATES.find((t) => t.code === "invoice")!.fields)

const scalarFields: DocumentFieldDefinition[] = [
  { key: "vendor", label: "Supplier", type: "string", instruction: "", required: false },
  { key: "total", label: "Total", type: "number", instruction: "", required: false },
  { key: "issue_date", label: "Issue date", type: "date", instruction: "", required: false },
  { key: "paid", label: "Paid", type: "boolean", instruction: "", required: false },
]

describe("flattenDocumentValues", () => {
  it("produces one row per populated scalar field with typed columns filled", () => {
    const rows = flattenDocumentValues(scalarFields, { vendor: "Acme", total: 1200.5, issue_date: "2025-03-04", paid: true })
    const byKey = Object.fromEntries(rows.map((r) => [r.fieldKey, r]))
    expect(byKey.vendor.valueText).toBe("Acme")
    expect(byKey.vendor.valueNumber).toBeNull()
    expect(byKey.total.valueNumber).toBe(1200.5)
    expect(byKey.total.valueText).toBe("1200.5")
    expect(byKey.issue_date.valueDate).toBe("2025-03-04")
    expect(byKey.paid.valueBool).toBe(true)
  })

  it("skips empty, null and undefined values", () => {
    const rows = flattenDocumentValues(scalarFields, { vendor: "", total: null })
    expect(rows).toHaveLength(0)
  })

  it("parses string numbers with commas into valueNumber", () => {
    const [row] = flattenDocumentValues([scalarFields[1]], { total: "1,234.50" })
    expect(row.valueNumber).toBe(1234.5)
    expect(row.valueText).toBe("1,234.50")
  })

  it("leaves valueNumber null for non-numeric strings", () => {
    const [row] = flattenDocumentValues([scalarFields[1]], { total: "N/A" })
    expect(row.valueNumber).toBeNull()
    expect(row.valueText).toBe("N/A")
  })

  it("rejects bad dates into valueDate null but keeps the text", () => {
    const [row] = flattenDocumentValues([scalarFields[2]], { issue_date: "March 4 2025" })
    expect(row.valueDate).toBeNull()
    expect(row.valueText).toBe("March 4 2025")
  })

  it("rejects impossible ISO-shaped dates", () => {
    const [row] = flattenDocumentValues([scalarFields[2]], { issue_date: "2025-13-40" })
    expect(row.valueDate).toBeNull()
  })

  it("coerces string booleans", () => {
    expect(flattenDocumentValues([scalarFields[3]], { paid: "true" })[0].valueBool).toBe(true)
    expect(flattenDocumentValues([scalarFields[3]], { paid: "false" })[0].valueBool).toBe(false)
  })

  it("expands nested line items into one row per (itemIndex, itemKey)", () => {
    const rows = flattenDocumentValues(invoiceFields, {
      vendor: "Acme",
      line_items: [
        { description: "Widget", quantity: 2, unit_price: 20, amount: 40 },
        { description: "Bolt", amount: 2.5 },
      ],
    })
    const items = rows.filter((r) => r.fieldKey === "line_items")
    // First row has 4 populated cells, second has 2 → 6 item rows.
    expect(items).toHaveLength(6)
    const firstDesc = items.find((r) => r.itemIndex === 0 && r.itemKey === "description")!
    expect(firstDesc.valueText).toBe("Widget")
    const firstAmount = items.find((r) => r.itemIndex === 0 && r.itemKey === "amount")!
    expect(firstAmount.valueNumber).toBe(40)
    const secondDesc = items.find((r) => r.itemIndex === 1 && r.itemKey === "description")!
    expect(secondDesc.valueText).toBe("Bolt")
  })

  it("treats a bare array (no item fields) as one text row per element", () => {
    const fields: DocumentFieldDefinition[] = [{ key: "tags", label: "Tags", type: "array", instruction: "", required: false }]
    const rows = flattenDocumentValues(fields, { tags: ["a", "b", "c"] })
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.valueText)).toEqual(["a", "b", "c"])
    expect(rows.every((r) => r.itemKey === null)).toBe(true)
  })

  it("never throws on garbage data and caps the row count", () => {
    const fields: DocumentFieldDefinition[] = [{
      key: "line_items", label: "Line items", type: "array", instruction: "", required: false,
      itemFields: [{ key: "amount", label: "Amount", type: "number", instruction: "", required: false }],
    }]
    const many = Array.from({ length: MAX_FIELD_VALUE_ROWS + 500 }, (_, i) => ({ amount: i }))
    const rows = flattenDocumentValues(fields, { line_items: many })
    expect(rows.length).toBe(MAX_FIELD_VALUE_ROWS)
  })

  it("ignores unknown keys and non-object data", () => {
    expect(flattenDocumentValues(scalarFields, { unknown: "x" } as Record<string, unknown>)).toHaveLength(0)
    expect(flattenDocumentValues(scalarFields, null as unknown as Record<string, unknown>)).toHaveLength(0)
  })
})
