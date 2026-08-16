import { documentExportRow, exportColumnLabels, exportColumns, flattenedItemRows, lineItemExportRows } from "@/lib/document-export"
import { parseTemplateFields, DEFAULT_DOCUMENT_TEMPLATES } from "@/lib/document-templates"
import { describe, expect, it } from "vitest"

const invoiceFields = parseTemplateFields(DEFAULT_DOCUMENT_TEMPLATES.find((t) => t.code === "invoice")!.fields)
const receiptFields = parseTemplateFields(DEFAULT_DOCUMENT_TEMPLATES.find((t) => t.code === "receipt")!.fields)

const makeDoc = (overrides: Partial<Parameters<typeof documentExportRow>[0]> = {}) => ({
  filename: "receipt.jpg",
  status: "reviewed",
  receivedAt: new Date("2026-08-10T12:00:00Z"),
  reviewedData: { merchant: "Store", total: 42.5, line_items: [{ description: "Widget", quantity: 2, unit_price: 20, amount: 40 }, { description: "Tax", amount: 2.5 }] },
  rawExtraction: null,
  ...overrides,
})

describe("documentExportRow", () => {
  it("returns prefix columns plus template-ordered field columns", () => {
    const row = documentExportRow(makeDoc(), receiptFields)
    expect(row.filename).toBe("receipt.jpg")
    expect(row.status).toBe("reviewed")
    expect(row.received_at).toBe("2026-08-10T12:00:00.000Z")
    expect(row.merchant).toBe("Store")
    expect(row.total).toBe(42.5)
    expect(row.line_items).toBe("2 items")
  })

  it("falls back to rawExtraction when reviewedData is null", () => {
    const row = documentExportRow(makeDoc({ reviewedData: null, rawExtraction: { merchant: "Raw" } }), receiptFields)
    expect(row.merchant).toBe("Raw")
  })

  it("shows empty string for missing fields", () => {
    const row = documentExportRow(makeDoc({ reviewedData: {} }), receiptFields)
    expect(row.merchant).toBe("")
    expect(row.total).toBe("")
  })

  it("serializes objects/arrays as JSON strings", () => {
    const row = documentExportRow(makeDoc({ reviewedData: { merchant: "X", total: 1, line_items: [{ description: "A", amount: 1 }] } }), receiptFields)
    expect(row.line_items).toBe("1 item")
  })
})

describe("lineItemExportRows", () => {
  it("produces one row per line item with parent scalars repeated", () => {
    const rows = lineItemExportRows(makeDoc(), receiptFields)
    expect(rows).toHaveLength(2)
    expect(rows[0].filename).toBe("receipt.jpg")
    expect(rows[0].merchant).toBe("Store")
    expect(rows[0].item_description).toBe("Widget")
    expect(rows[0].item_quantity).toBe(2)
    expect(rows[0].item_amount).toBe(40)
    expect(rows[1].item_description).toBe("Tax")
    expect(rows[1].item_amount).toBe(2.5)
  })

  it("returns empty array when no array fields have items", () => {
    const rows = lineItemExportRows(makeDoc({ reviewedData: { merchant: "X" } }), receiptFields)
    expect(rows).toEqual([])
  })

  it("works with invoice templates", () => {
    const doc = makeDoc({ reviewedData: { vendor: "Acme", total: 100, line_items: [{ description: "Service", amount: 100 }] } })
    const rows = lineItemExportRows(doc, invoiceFields)
    expect(rows).toHaveLength(1)
    expect(rows[0].vendor).toBe("Acme")
    expect(rows[0].item_description).toBe("Service")
  })
})

describe("flattenedItemRows", () => {
  const data = makeDoc().reviewedData as Record<string, unknown>

  it("yields one row per line item with position and raw values", () => {
    const rows = flattenedItemRows(data, receiptFields)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ arrayKey: "line_items", itemIndex: 0 })
    expect(rows[0].item.description).toBe("Widget")
    expect(rows[0].item.quantity).toBe(2)
    expect(rows[1]).toMatchObject({ arrayKey: "line_items", itemIndex: 1 })
    expect(rows[1].item.amount).toBe(2.5)
  })

  it("yields a single placeholder row when the document has no items", () => {
    expect(flattenedItemRows({ merchant: "X" }, receiptFields)).toEqual([{ arrayKey: "line_items", itemIndex: null, item: {} }])
    expect(flattenedItemRows({}, [receiptFields[0]])).toEqual([{ arrayKey: null, itemIndex: null, item: {} }])
  })

  it("skips malformed entries but keeps original array positions for write-back", () => {
    const rows = flattenedItemRows({ line_items: [null, "junk", { description: "Real" }] }, receiptFields)
    expect(rows).toHaveLength(1)
    expect(rows[0].item.description).toBe("Real")
    expect(rows[0].itemIndex).toBe(2)
  })
})

describe("exportColumns", () => {
  it("documents sheet includes all field keys", () => {
    const cols = exportColumns(receiptFields, "documents")
    expect(cols.slice(0, 3)).toEqual(["filename", "status", "received_at"])
    expect(cols).toContain("merchant")
    expect(cols).toContain("total")
    expect(cols).toContain("line_items")
  })

  it("line_items sheet replaces array fields with item_ prefixed columns", () => {
    const cols = exportColumns(receiptFields, "line_items")
    expect(cols).not.toContain("line_items")
    expect(cols).toContain("item_description")
    expect(cols).toContain("item_amount")
    expect(cols).toContain("merchant")
  })
})

describe("exportColumnLabels", () => {
  it("returns human labels for all columns", () => {
    const labels = exportColumnLabels(receiptFields, "documents")
    expect(labels.filename).toBe("Filename")
    expect(labels.merchant).toBe("Merchant")
    expect(labels.line_items).toBe("Line items")
  })

  it("line_items sheet uses item field labels", () => {
    const labels = exportColumnLabels(receiptFields, "line_items")
    expect(labels.item_description).toBe("Description")
    expect(labels.item_amount).toBe("Amount")
  })
})
