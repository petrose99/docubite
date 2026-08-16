import { buildDocumentJsonSchema, buildDocumentPrompt, DEFAULT_DOCUMENT_TEMPLATES, extractClassification, extractFieldConfidence, extractFieldProvenance, findMissingRequiredFields, parseTemplateFields, validateDocumentValues } from "@/lib/document-templates"
import { describe, expect, it } from "vitest"

describe("document templates", () => {
  const fields = parseTemplateFields([
    { key: "supplier", label: "Supplier", type: "string", required: true, instruction: "Vendor name" },
    { key: "total", label: "Total", type: "number", required: false, instruction: "Total payable" },
  ])

  it("creates strict structured-output schemas", () => {
    const schema = buildDocumentJsonSchema(fields)
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(["supplier"])
    expect(schema.properties.total).toMatchObject({ type: "number" })
  })

  it("identifies required values that still need review", () => {
    expect(findMissingRequiredFields(fields, { total: 12 })).toEqual(["supplier"])
    expect(findMissingRequiredFields(fields, { supplier: "Acme", total: 12 })).toEqual([])
  })

  it("rejects duplicate or unsafe field keys", () => {
    expect(() => parseTemplateFields([
      { key: "same", label: "One", type: "string", required: false, instruction: "" },
      { key: "same", label: "Two", type: "string", required: false, instruction: "" },
    ])).toThrow(/unique/)
    expect(() => parseTemplateFields([{ key: "Total amount", label: "Total", type: "number", required: false, instruction: "" }])).toThrow()
  })

  it("validates typed values and ignores values outside the snapshot", () => {
    const snapshot = parseTemplateFields([
      { key: "issue_date", label: "Issue date", type: "date", required: true, instruction: "" },
      { key: "total", label: "Total", type: "number", required: false, instruction: "" },
      { key: "status", label: "Status", type: "enum", options: ["paid", "due"], required: false, instruction: "" },
    ])
    expect(validateDocumentValues(snapshot, { issue_date: "2026-08-12", total: 12.5, status: "paid", unexpected: "drop" })).toEqual({ issue_date: "2026-08-12", total: 12.5, status: "paid" })
    expect(validateDocumentValues(snapshot, { issue_date: "12/08/2026", total: "12.5", status: "wrong" })).toEqual({})
  })

  it("preserves supported custom types and makes currency extraction literal", () => {
    const custom = parseTemplateFields([
      { key: "approved", label: "Approved", type: "boolean", required: true, instruction: "Approval mark" },
      { key: "tags", label: "Tags", type: "array", required: false, instruction: "Line items" },
      { key: "stage", label: "Stage", type: "enum", options: ["new", "ready"], required: false, instruction: "Review stage" },
    ])
    expect(validateDocumentValues(custom, { approved: true, tags: [{ name: "Travel" }], stage: "ready" })).toEqual({ approved: true, tags: [{ name: "Travel" }], stage: "ready" })
    expect(buildDocumentPrompt("Invoice", custom)).toContain("Never convert currencies")
  })

  describe("structured line items", () => {
    const lineItemFields = parseTemplateFields([
      { key: "vendor", label: "Vendor", type: "string", required: true, instruction: "" },
      { key: "line_items", label: "Line items", type: "array", required: false, instruction: "Billed items", itemFields: [
        { key: "description", label: "Description", type: "string", required: false, instruction: "" },
        { key: "amount", label: "Amount", type: "number", required: true, instruction: "" },
      ] },
    ])

    it("builds a real object schema for array items instead of additionalProperties: true", () => {
      const schema = buildDocumentJsonSchema(lineItemFields)
      const lineItemsProperty = schema.properties.line_items as { items: { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean } }
      expect(lineItemsProperty.items.additionalProperties).toBe(false)
      expect(lineItemsProperty.items.required).toEqual(["amount"])
      expect(lineItemsProperty.items.properties).toHaveProperty("description")
      expect(lineItemsProperty.items.properties).toHaveProperty("amount")
    })

    it("declares a _confidence property alongside the real fields", () => {
      const schema = buildDocumentJsonSchema(lineItemFields)
      expect(schema.properties).toHaveProperty("_confidence")
      expect(schema.properties._confidence).toMatchObject({ type: "object", additionalProperties: false })
    })

    it("validates each row against itemFields and drops invalid rows", () => {
      const value = validateDocumentValues(lineItemFields, {
        vendor: "Acme",
        line_items: [
          { description: "Widget", amount: 10 },
          { description: "Bad row", amount: "not a number" },
          { amount: 5 },
        ],
      })
      expect(value.line_items).toEqual([{ description: "Widget", amount: 10 }, { amount: 5 }])
    })

    it("omits the array field entirely when every row is empty", () => {
      const value = validateDocumentValues(lineItemFields, { vendor: "Acme", line_items: [{ amount: "bad" }] })
      expect(value).toEqual({ vendor: "Acme" })
    })

    it("keeps free-form arrays working for legacy fields without itemFields", () => {
      const legacy = parseTemplateFields([{ key: "tags", label: "Tags", type: "array", required: false, instruction: "" }])
      expect(validateDocumentValues(legacy, { tags: [{ anything: "goes" }] })).toEqual({ tags: [{ anything: "goes" }] })
    })

    it("rejects item fields on a non-array field", () => {
      expect(() => parseTemplateFields([
        { key: "total", label: "Total", type: "number", required: false, instruction: "", itemFields: [{ key: "x", label: "X", type: "string", required: false, instruction: "" }] },
      ])).toThrow()
    })

    it("includes item field instructions in the extraction prompt", () => {
      const prompt = buildDocumentPrompt("Invoice", lineItemFields)
      expect(prompt).toContain("line_items")
      expect(prompt).toContain("  - description")
      expect(prompt).toContain("  - amount")
    })
  })

  describe("mergeStrategy", () => {
    it("defaults to undefined so untagged fields keep first-pass precedence", () => {
      const parsed = parseTemplateFields([{ key: "vendor", label: "Vendor", type: "string", required: true, instruction: "" }])
      expect(parsed[0].mergeStrategy).toBeUndefined()
    })

    it("keeps an explicit strategy on scalar fields", () => {
      const parsed = parseTemplateFields([{ key: "total", label: "Total", type: "number", required: true, instruction: "", mergeStrategy: "last" }])
      expect(parsed[0].mergeStrategy).toBe("last")
    })

    it("rejects an unknown strategy", () => {
      expect(() => parseTemplateFields([{ key: "total", label: "Total", type: "number", required: true, instruction: "", mergeStrategy: "highest" }])).toThrow()
    })

    it("rejects a strategy on an array field, which always concatenates", () => {
      expect(() => parseTemplateFields([{ key: "line_items", label: "Line items", type: "array", required: false, instruction: "", mergeStrategy: "last" }])).toThrow(/concatenate/)
    })
  })

  describe("system templates", () => {
    it("receipt template includes line_items with structured item fields", () => {
      const receipt = DEFAULT_DOCUMENT_TEMPLATES.find((t) => t.code === "receipt")
      expect(receipt).toBeDefined()
      const fields = parseTemplateFields(receipt!.fields)
      const lineItems = fields.find((f) => f.key === "line_items")
      expect(lineItems).toBeDefined()
      expect(lineItems!.type).toBe("array")
      const itemKeys = lineItems!.itemFields!.map((f) => f.key)
      expect(itemKeys).toEqual(["description", "quantity", "unit_price", "amount"])
    })

    it("invoice template includes line_items with structured item fields", () => {
      const invoice = DEFAULT_DOCUMENT_TEMPLATES.find((t) => t.code === "invoice")
      expect(invoice).toBeDefined()
      const fields = parseTemplateFields(invoice!.fields)
      const lineItems = fields.find((f) => f.key === "line_items")
      expect(lineItems).toBeDefined()
      expect(lineItems!.type).toBe("array")
      const itemKeys = lineItems!.itemFields!.map((f) => f.key)
      expect(itemKeys).toEqual(["description", "quantity", "unit_price", "amount"])
    })

    it("marks invoice and receipt total fields as last-page summaries", () => {
      const strategies = (code: string) => {
        const template = DEFAULT_DOCUMENT_TEMPLATES.find((t) => t.code === code)
        return Object.fromEntries(parseTemplateFields(template!.fields).map((field) => [field.key, field.mergeStrategy]))
      }
      expect(strategies("invoice")).toMatchObject({ subtotal: "last", tax_total: "last", total: "last", vendor: undefined, invoice_number: undefined, issue_date: undefined })
      expect(strategies("receipt")).toMatchObject({ tax_total: "last", total: "last", merchant: undefined, purchase_date: undefined })
    })

    it("ships the line-item templates in multi-row mode so every item gets its own grid row", () => {
      const multiRow = (code: string) => DEFAULT_DOCUMENT_TEMPLATES.find((t) => t.code === code)!.multiRow
      expect(multiRow("invoice")).toBe(true)
      expect(multiRow("receipt")).toBe(true)
      expect(multiRow("generic")).toBe(false)
    })

    it("all default templates parse successfully", () => {
      for (const template of DEFAULT_DOCUMENT_TEMPLATES) {
        expect(() => parseTemplateFields(template.fields)).not.toThrow()
      }
    })
  })

  describe("extractFieldConfidence", () => {
    it("reads and clamps per-field confidence to [0, 1]", () => {
      const confidence = extractFieldConfidence(fields, { supplier: "Acme", _confidence: { supplier: 0.92, total: 1.4 } })
      expect(confidence).toEqual({ supplier: 0.92, total: 1 })
    })

    it("ignores non-numeric or missing confidence values", () => {
      expect(extractFieldConfidence(fields, { _confidence: { supplier: "high" } })).toEqual({})
      expect(extractFieldConfidence(fields, {})).toEqual({})
    })
  })

  describe("_provenance schema", () => {
    const provFields = parseTemplateFields([
      { key: "vendor", label: "Vendor", type: "string", required: true, instruction: "" },
      { key: "line_items", label: "Line items", type: "array", required: false, instruction: "", itemFields: [
        { key: "amount", label: "Amount", type: "number", required: true, instruction: "" },
      ] },
    ])

    it("declares a _provenance property listed after the value fields and _confidence", () => {
      const schema = buildDocumentJsonSchema(provFields)
      const keys = Object.keys(schema.properties)
      expect(keys).toEqual(["vendor", "line_items", "_confidence", "_provenance", "_classification"])
    })

    it("gives scalar fields a page+quote object and array fields a list of them", () => {
      const schema = buildDocumentJsonSchema(provFields)
      const provenance = schema.properties._provenance as { properties: Record<string, { type: string; items?: { type: string } }> }
      expect(provenance.properties.vendor).toMatchObject({ type: "object", additionalProperties: false })
      expect(provenance.properties.vendor.properties).toHaveProperty("page")
      expect(provenance.properties.vendor.properties).toHaveProperty("quote")
      expect(provenance.properties.line_items).toMatchObject({ type: "array" })
      expect(provenance.properties.line_items.items).toMatchObject({ type: "object" })
    })

    it("asks for page and verbatim quote in the prompt", () => {
      expect(buildDocumentPrompt("Invoice", provFields)).toContain("_provenance")
    })
  })

  describe("extractFieldProvenance", () => {
    const provFields = parseTemplateFields([
      { key: "vendor", label: "Vendor", type: "string", required: true, instruction: "" },
      { key: "total", label: "Total", type: "number", required: false, instruction: "" },
      { key: "line_items", label: "Line items", type: "array", required: false, instruction: "", itemFields: [
        { key: "amount", label: "Amount", type: "number", required: true, instruction: "" },
      ] },
    ])

    it("reads scalar hints and clamps the quote to 120 chars", () => {
      const longQuote = "x".repeat(200)
      const hints = extractFieldProvenance(provFields, { _provenance: { vendor: { page: 1, quote: longQuote }, total: { page: 2, quote: "Total 99" } } })
      expect(hints.fields.vendor).toEqual({ page: 1, quote: "x".repeat(120) })
      expect(hints.fields.total).toEqual({ page: 2, quote: "Total 99" })
    })

    it("drops non-positive or non-integer pages to null and tolerates garbage", () => {
      const hints = extractFieldProvenance(provFields, { _provenance: { vendor: { page: 0, quote: "Acme" }, total: { page: 2.5, quote: "99" } } })
      expect(hints.fields.vendor).toEqual({ page: null, quote: "Acme" })
      expect(hints.fields.total).toEqual({ page: null, quote: "99" })
    })

    it("keeps one aligned slot per array row, nulling unusable entries", () => {
      const hints = extractFieldProvenance(provFields, { _provenance: { line_items: [{ page: 1, quote: "Widget" }, "garbage", { quote: "" }] } })
      expect(hints.items.line_items).toEqual([{ page: 1, quote: "Widget" }, null, null])
    })

    it("returns empty maps when _provenance is absent or malformed", () => {
      expect(extractFieldProvenance(provFields, {})).toEqual({ fields: {}, items: {} })
      expect(extractFieldProvenance(provFields, { _provenance: "nope" })).toEqual({ fields: {}, items: {} })
    })
  })

  describe("extractClassification", () => {
    it("reads and clamps the classification labels to 80 chars", () => {
      const result = extractClassification({ _classification: { doc_type: "Invoice", entity: "x".repeat(200), period: "2026-01" } })
      expect(result).toEqual({ docType: "Invoice", entity: "x".repeat(80), period: "2026-01" })
    })

    it("defaults every field to empty when absent or malformed", () => {
      expect(extractClassification({})).toEqual({ docType: "", entity: "", period: "" })
      expect(extractClassification({ _classification: { doc_type: 42 } })).toEqual({ docType: "", entity: "", period: "" })
    })

    it("declares a _classification schema property", () => {
      const schema = buildDocumentJsonSchema(parseTemplateFields([{ key: "vendor", label: "Vendor", type: "string", required: true, instruction: "" }]))
      expect(schema.properties).toHaveProperty("_classification")
    })
  })
})
