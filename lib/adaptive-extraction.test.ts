import { mergeDiscoveredFields } from "@/lib/adaptive-extraction"
import { DocumentFieldDefinition, DocumentItemFieldDefinition } from "@/lib/document-templates"
import { describe, expect, it } from "vitest"

const invoiceItemFields: DocumentItemFieldDefinition[] = [
  { key: "description", label: "Description", type: "string", instruction: "What was billed", required: false },
  { key: "quantity", label: "Quantity", type: "number", instruction: "Quantity billed", required: false },
  { key: "unit_price", label: "Unit price", type: "number", instruction: "Price per unit before tax", required: false },
  { key: "amount", label: "Amount", type: "number", instruction: "Line total", required: false },
]

const templateFields: DocumentFieldDefinition[] = [
  { key: "vendor_name", label: "Vendor", type: "string", instruction: "Vendor name", required: false },
  { key: "total", label: "Total", type: "number", instruction: "Total amount", required: false, mergeStrategy: "last" },
  { key: "line_items", label: "Line items", type: "array", instruction: "Each billed line item", required: false, itemFields: invoiceItemFields },
  { key: "currency_code", label: "Currency", type: "string", instruction: "ISO currency code", required: false },
]

function itemField(key: string): DocumentItemFieldDefinition {
  return { key, label: key, type: "string", instruction: "", required: false }
}

describe("mergeDiscoveredFields", () => {
  it("unions template item keys with discovered ones, keeping the four canonical keys", () => {
    const discovered = [...invoiceItemFields, itemField("product_code"), itemField("country"), itemField("color")]
    const merged = mergeDiscoveredFields(templateFields, discovered)
    const lineItems = merged.find((field) => field.key === "line_items")
    expect(lineItems?.itemFields?.map((item) => item.key)).toEqual(["description", "quantity", "unit_price", "amount", "product_code", "country", "color"])
  })

  it("dedups by key, template value winning over a same-keyed discovered one", () => {
    const discovered = [{ ...itemField("description"), label: "Discovered label" }, itemField("product_code")]
    const merged = mergeDiscoveredFields(templateFields, discovered)
    const lineItems = merged.find((field) => field.key === "line_items")
    expect(lineItems?.itemFields?.filter((item) => item.key === "description")).toHaveLength(1)
    expect(lineItems?.itemFields?.find((item) => item.key === "description")?.label).toBe("Description")
    expect(lineItems?.itemFields?.map((item) => item.key)).toContain("product_code")
  })

  it("caps at 20 item fields without dropping the template's own keys", () => {
    const discovered = Array.from({ length: 30 }, (_, index) => itemField(`extra_${index}`))
    const merged = mergeDiscoveredFields(templateFields, discovered)
    const lineItems = merged.find((field) => field.key === "line_items")
    expect(lineItems?.itemFields).toHaveLength(20)
    for (const key of ["description", "quantity", "unit_price", "amount"]) {
      expect(lineItems?.itemFields?.map((item) => item.key)).toContain(key)
    }
  })

  it("returns the template unchanged when there is no array field", () => {
    const noArrayFields: DocumentFieldDefinition[] = [{ key: "vendor_name", label: "Vendor", type: "string", instruction: "", required: false }]
    expect(mergeDiscoveredFields(noArrayFields, [itemField("product_code")])).toBe(noArrayFields)
  })

  it("preserves header field order and every non-array field untouched", () => {
    const merged = mergeDiscoveredFields(templateFields, [itemField("product_code")])
    expect(merged.map((field) => field.key)).toEqual(["vendor_name", "total", "line_items", "currency_code"])
    expect(merged[0]).toEqual(templateFields[0])
    expect(merged[1]).toEqual(templateFields[1])
    expect(merged[3]).toEqual(templateFields[3])
  })
})
