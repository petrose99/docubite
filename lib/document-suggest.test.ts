import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/prisma/client", () => ({ Prisma: {}, PrismaClient: vi.fn() }))
vi.mock("@/models/workspaces", () => ({ consumeWorkspaceQuota: vi.fn() }))
vi.mock("@/lib/document-storage", () => ({ readDocumentSource: vi.fn() }))
vi.mock("@/lib/malware-scan", () => ({ scanDocumentBuffer: vi.fn() }))
vi.mock("@/ai/providers/llmProvider", () => ({ requestLLM: vi.fn() }))
vi.mock("@/lib/mineru", () => ({ parseDocumentWithMineru: vi.fn() }))

const { buildFieldSuggestionPrompt, buildSingleColumnPrompt, fieldSuggestionJsonSchema, parseSuggestedFields } = await import("@/lib/document-suggest")

describe("buildFieldSuggestionPrompt", () => {
  it("states the key format, allowed types, and companion outputs", () => {
    const prompt = buildFieldSuggestionPrompt()
    expect(prompt).toContain("snake_case")
    expect(prompt).toContain("string, number, date, boolean, enum, array")
    expect(prompt).toContain("template_name")
    expect(prompt).toContain("extra_instructions")
  })
})

describe("buildSingleColumnPrompt", () => {
  it("carries the user's description and asks for exactly one field", () => {
    const prompt = buildSingleColumnPrompt("total including tax")
    expect(prompt).toContain("total including tax")
    expect(prompt).toContain("exactly one")
  })
})

describe("fieldSuggestionJsonSchema", () => {
  it("requires fields and forbids extra properties", () => {
    expect(fieldSuggestionJsonSchema.required).toEqual(["fields"])
    expect(fieldSuggestionJsonSchema.additionalProperties).toBe(false)
  })
})

describe("parseSuggestedFields", () => {
  it("passes well-formed output through with defaults applied", () => {
    const result = parseSuggestedFields({
      template_name: "Invoice",
      extra_instructions: "Extract each line item as its own row.",
      fields: [
        { key: "vendor_name", label: "Vendor Name", type: "string", instruction: "Seller name", required: true },
        { key: "total", label: "Total", type: "number" },
      ],
    })
    expect(result).not.toBeNull()
    expect(result!.name).toBe("Invoice")
    expect(result!.prompt).toContain("line item")
    expect(result!.fields.map((field) => field.key)).toEqual(["vendor_name", "total"])
    expect(result!.fields[1].instruction).toBe("")
    expect(result!.fields[1].required).toBe(false)
  })

  it("coerces sloppy keys and drops irreparable entries", () => {
    const result = parseSuggestedFields({
      fields: [
        { key: "Vendor Name!", label: "Vendor Name", type: "string" },
        { key: "1st_column", label: "Broken", type: "string" },
        { key: "", label: "No key", type: "string" },
        { key: "ok", label: "", type: "string" },
      ],
    })
    expect(result).not.toBeNull()
    expect(result!.fields.map((field) => field.key)).toEqual(["vendor_name", "st_column"])
  })

  it("downgrades unknown types to string and enum without options to string", () => {
    const result = parseSuggestedFields({
      fields: [
        { key: "weird", label: "Weird", type: "geolocation" },
        { key: "kind", label: "Kind", type: "enum", options: [] },
        { key: "status", label: "Status", type: "enum", options: ["paid", "unpaid"] },
      ],
    })
    expect(result!.fields[0].type).toBe("string")
    expect(result!.fields[1].type).toBe("string")
    expect(result!.fields[2].type).toBe("enum")
    expect(result!.fields[2].options).toEqual(["paid", "unpaid"])
  })

  it("keeps one array field with coerced item fields and drops arrays without usable items", () => {
    const result = parseSuggestedFields({
      fields: [
        { key: "line_items", label: "Line Items", type: "array", item_fields: [
          { key: "Description", label: "Description", type: "string" },
          { key: "amount", label: "Amount", type: "array" },
        ] },
        { key: "empty_table", label: "Empty", type: "array", item_fields: [] },
      ],
    })
    expect(result!.fields).toHaveLength(1)
    expect(result!.fields[0].key).toBe("line_items")
    expect(result!.fields[0].itemFields!.map((item) => item.key)).toEqual(["description", "amount"])
    expect(result!.fields[0].itemFields![1].type).toBe("string")
  })

  it("deduplicates repeated keys keeping the first", () => {
    const result = parseSuggestedFields({ fields: [
      { key: "total", label: "Total", type: "number" },
      { key: "total", label: "Total Again", type: "string" },
    ] })
    expect(result!.fields).toHaveLength(1)
    expect(result!.fields[0].type).toBe("number")
  })

  it("returns null when nothing usable survives", () => {
    expect(parseSuggestedFields(null)).toBeNull()
    expect(parseSuggestedFields({})).toBeNull()
    expect(parseSuggestedFields({ fields: [{ key: "", label: "" }] })).toBeNull()
    expect(parseSuggestedFields([1, 2])).toBeNull()
  })
})
