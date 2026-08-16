import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/prisma/client", () => ({ Prisma: {}, PrismaClient: vi.fn() }))
vi.mock("@/models/workspaces", () => ({ consumeWorkspaceQuota: vi.fn() }))
vi.mock("@/lib/document-storage", () => ({ readDocumentSource: vi.fn() }))
vi.mock("@/lib/malware-scan", () => ({ scanDocumentBuffer: vi.fn() }))
vi.mock("@/ai/providers/llmProvider", () => ({ requestLLM: vi.fn() }))
vi.mock("@/lib/mineru", () => ({ parseDocumentWithMineru: vi.fn() }))

const { buildBatchParts, findConflictingScalarFields, mergeClassification, mergeExtractionPasses, mergeFieldConfidence, mergeProvenancePasses, pageBatches, PERMANENT_ERROR_CODES } = await import("@/lib/document-processing")
const { parseTemplateFields } = await import("@/lib/document-templates")

function safeErrorCode(error: unknown) {
  const raw = error instanceof Error ? error.message : "processing_failed"
  return raw.replace(/[^a-z0-9_]/gi, "_").slice(0, 96).toLowerCase()
}

function pdfPageCount(source: Buffer) {
  return (source.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length
}

describe("safeErrorCode", () => {
  it("sanitizes Error messages to alphanumeric+underscore", () => {
    expect(safeErrorCode(new Error("malware_detected"))).toBe("malware_detected")
    expect(safeErrorCode(new Error("bad input!@#$%"))).toBe("bad_input_____")
  })

  it("defaults to processing_failed for non-Error values", () => {
    expect(safeErrorCode("string")).toBe("processing_failed")
    expect(safeErrorCode(null)).toBe("processing_failed")
    expect(safeErrorCode(undefined)).toBe("processing_failed")
  })

  it("truncates long error codes to 96 characters", () => {
    const long = new Error("a".repeat(200))
    expect(safeErrorCode(long).length).toBe(96)
  })
})

describe("pdfPageCount", () => {
  it("counts /Type /Page markers in a PDF buffer", () => {
    const pdf = Buffer.from("%PDF-1.7\n/Type /Page\n/Type /Page\n/Type /Page\n%%EOF")
    expect(pdfPageCount(pdf)).toBe(3)
  })

  it("returns 0 for a non-PDF buffer", () => {
    expect(pdfPageCount(Buffer.from("hello world"))).toBe(0)
  })

  it("handles varied whitespace between Type and Page", () => {
    const pdf = Buffer.from("/Type  /Page\n/Type\t/Page")
    expect(pdfPageCount(pdf)).toBe(2)
  })
})

describe("pageBatches", () => {
  it("splits pages into fixed-size batches", () => {
    expect(pageBatches(20, 8)).toEqual([
      [1, 2, 3, 4, 5, 6, 7, 8],
      [9, 10, 11, 12, 13, 14, 15, 16],
      [17, 18, 19, 20],
    ])
  })

  it("returns a single batch when pageCount fits under the batch size", () => {
    expect(pageBatches(3, 8)).toEqual([[1, 2, 3]])
  })

  it("returns no batches for zero pages", () => {
    expect(pageBatches(0, 8)).toEqual([])
  })
})

describe("PERMANENT_ERROR_CODES", () => {
  it("fails the document immediately on limits and misconfiguration, but retries parse failures", () => {
    expect(PERMANENT_ERROR_CODES).toEqual(expect.arrayContaining(["mineru_file_too_large", "mineru_page_limit_exceeded", "mineru_not_configured", "invalid_page_range"]))
    expect(PERMANENT_ERROR_CODES).not.toContain("mineru_parse_failed")
    expect(PERMANENT_ERROR_CODES).not.toContain("mineru_timeout")
    expect(PERMANENT_ERROR_CODES).not.toContain("mineru_upload_failed")
  })
})

describe("buildBatchParts", () => {
  const label = (page: number) => `--- Page ${page} (parsed document text, markdown; may contain recognition errors) ---`

  it("sends each page as a labelled text part", () => {
    const parts = buildBatchParts([{ page: 1, text: "INVOICE 42" }, { page: 2, text: "Total 10" }], [1, 2])
    expect(parts.textParts).toEqual([`${label(1)}\nINVOICE 42`, `${label(2)}\nTotal 10`])
  })

  it("only includes pages belonging to this batch", () => {
    const contents = [{ page: 1, text: "one" }, { page: 2, text: "two" }, { page: 3, text: "three" }]
    expect(buildBatchParts(contents, [2, 3])).toEqual({ textParts: [`${label(2)}\ntwo`, `${label(3)}\nthree`] })
  })

  it("returns nothing for a batch with no matching pages", () => {
    expect(buildBatchParts([{ page: 1, text: "one" }], [9])).toEqual({ textParts: [] })
  })
})

describe("mergeExtractionPasses", () => {
  const fields = parseTemplateFields([
    { key: "vendor", label: "Vendor", type: "string", required: true, instruction: "" },
    { key: "total", label: "Total", type: "number", required: false, instruction: "" },
    { key: "line_items", label: "Line items", type: "array", required: false, instruction: "" },
  ])

  it("takes the first non-empty scalar value across passes (page 1 wins)", () => {
    const merged = mergeExtractionPasses(fields, [
      { vendor: "Acme", total: 100 },
      { vendor: "Wrong Read", total: 999 },
    ])
    expect(merged).toEqual({ vendor: "Acme", total: 100 })
  })

  it("falls through to a later pass when an earlier one is missing the field", () => {
    const merged = mergeExtractionPasses(fields, [
      { line_items: [] },
      { vendor: "Acme" },
    ])
    expect(merged.vendor).toBe("Acme")
  })

  it("concatenates array fields across every pass instead of taking the first", () => {
    const merged = mergeExtractionPasses(fields, [
      { vendor: "Acme", line_items: [{ description: "Item 1" }] },
      { line_items: [{ description: "Item 2" }, { description: "Item 3" }] },
    ])
    expect(merged.line_items).toEqual([{ description: "Item 1" }, { description: "Item 2" }, { description: "Item 3" }])
  })

  it("omits an array field entirely when no pass contributed rows", () => {
    const merged = mergeExtractionPasses(fields, [{ vendor: "Acme" }])
    expect(merged).toEqual({ vendor: "Acme" })
  })

  it("returns an empty object when every pass is empty", () => {
    expect(mergeExtractionPasses(fields, [{}, {}])).toEqual({})
  })
})

/** The fields that carry a document-level summary printed after the content it summarizes.
 * Batching splits those away from the line items, so they resolve last-pass-wins. */
describe("mergeExtractionPasses with last-page summary fields", () => {
  const fields = parseTemplateFields([
    { key: "vendor", label: "Vendor", type: "string", required: true, instruction: "" },
    { key: "invoice_number", label: "Invoice number", type: "string", required: true, instruction: "" },
    { key: "subtotal", label: "Subtotal", type: "number", required: false, instruction: "", mergeStrategy: "last" },
    { key: "tax_total", label: "Tax total", type: "number", required: false, instruction: "", mergeStrategy: "last" },
    { key: "total", label: "Total", type: "number", required: true, instruction: "", mergeStrategy: "last" },
    { key: "line_items", label: "Line items", type: "array", required: false, instruction: "" },
  ])

  it("keeps the later total when an earlier pass guessed one from the lines it could see", () => {
    const merged = mergeExtractionPasses(fields, [
      { total: 9590.25 },
      { subtotal: 9815.25, tax_total: 1472.29, total: 11287.54 },
    ])
    expect(merged.total).toBe(11287.54)
    expect(merged.subtotal).toBe(9815.25)
    expect(merged.tax_total).toBe(1472.29)
  })

  it("still takes header fields from the first pass when a later pass disagrees", () => {
    const merged = mergeExtractionPasses(fields, [
      { vendor: "Acme", invoice_number: "INV-1" },
      { vendor: "Acme Continued", invoice_number: "INV-1 page 2 of 2", total: 50 },
    ])
    expect(merged.vendor).toBe("Acme")
    expect(merged.invoice_number).toBe("INV-1")
  })

  /** The reported repro: a 3-page invoice at DOCUMENT_PAGES_PER_BATCH=2, where batch 1 sees
   * five line items and no totals row, and batch 2 sees the real totals row. */
  it("resolves the reported 3-page invoice split across two batches", () => {
    const merged = mergeExtractionPasses(fields, [
      { vendor: "Acme", invoice_number: "INV-2026-118", total: 9590.25, line_items: [{ amount: 9590.25 }] },
      { subtotal: 9815.25, tax_total: 1472.29, total: 11287.54, line_items: [{ amount: 225 }] },
    ])
    expect(merged).toEqual({
      vendor: "Acme",
      invoice_number: "INV-2026-118",
      subtotal: 9815.25,
      tax_total: 1472.29,
      total: 11287.54,
      line_items: [{ amount: 9590.25 }, { amount: 225 }],
    })
  })

  it("falls back to an earlier total when the final pass reported none", () => {
    const merged = mergeExtractionPasses(fields, [
      { total: 120 },
      { subtotal: 100, total: 120 },
      { vendor: "Terms and conditions page" },
    ])
    expect(merged.total).toBe(120)
    expect(merged.subtotal).toBe(100)
  })

  it("keeps a zero total instead of falling through to an earlier guess", () => {
    expect(mergeExtractionPasses(fields, [{ total: 400 }, { total: 0 }]).total).toBe(0)
  })

  it("takes the only reported total no matter which pass reported it", () => {
    expect(mergeExtractionPasses(fields, [{ total: 42 }, {}]).total).toBe(42)
    expect(mergeExtractionPasses(fields, [{}, { total: 42 }]).total).toBe(42)
  })

  it("leaves single-batch documents untouched", () => {
    const single = { vendor: "Acme", invoice_number: "INV-1", subtotal: 100, tax_total: 15, total: 115 }
    expect(mergeExtractionPasses(fields, [single])).toEqual(single)
  })
})

describe("findConflictingScalarFields", () => {
  const fields = parseTemplateFields([
    { key: "vendor", label: "Vendor", type: "string", required: true, instruction: "" },
    { key: "total", label: "Total", type: "number", required: false, instruction: "", mergeStrategy: "last" },
    { key: "line_items", label: "Line items", type: "array", required: false, instruction: "" },
  ])

  it("reports scalar fields two passes read differently", () => {
    expect(findConflictingScalarFields(fields, [{ vendor: "Acme", total: 9590.25 }, { vendor: "Acme", total: 11287.54 }])).toEqual(["total"])
  })

  it("ignores fields every pass agreed on, or only one pass reported", () => {
    expect(findConflictingScalarFields(fields, [{ vendor: "Acme", total: 115 }, { vendor: "Acme", total: 115 }])).toEqual([])
    expect(findConflictingScalarFields(fields, [{ vendor: "Acme" }, { total: 115 }])).toEqual([])
  })

  it("ignores array fields, which concatenate rather than compete", () => {
    expect(findConflictingScalarFields(fields, [{ line_items: [{ amount: 1 }] }, { line_items: [{ amount: 2 }] }])).toEqual([])
  })

  it("returns nothing for a single pass", () => {
    expect(findConflictingScalarFields(fields, [{ vendor: "Acme", total: 115 }])).toEqual([])
  })
})

describe("mergeFieldConfidence", () => {
  const fields = parseTemplateFields([
    { key: "vendor", label: "Vendor", type: "string", required: true, instruction: "" },
    { key: "total", label: "Total", type: "number", required: false, instruction: "", mergeStrategy: "last" },
    { key: "line_items", label: "Line items", type: "array", required: false, instruction: "" },
  ])

  it("takes confidence from the pass that supplied the merged value", () => {
    const passes = [{ vendor: "Acme", total: 9590.25 }, { vendor: "Acme Continued", total: 11287.54 }]
    expect(mergeFieldConfidence(fields, passes, [{ vendor: 0.9, total: 0.8 }, { vendor: 0.4, total: 0.6 }])).toEqual({ vendor: 0.9, total: 0.6 })
  })

  it("skips fields no pass reported a value for", () => {
    expect(mergeFieldConfidence(fields, [{ vendor: "Acme" }], [{ vendor: 0.9, total: 0.5 }])).toEqual({ vendor: 0.9 })
  })

  it("takes array confidence from a pass that contributed rows", () => {
    const passes = [{}, { line_items: [{ amount: 1 }] }]
    expect(mergeFieldConfidence(fields, passes, [{ line_items: 0.3 }, { line_items: 0.7 }])).toEqual({ line_items: 0.7 })
  })

  it("falls through to another contributing pass when the winning one reported no score", () => {
    const passes = [{ vendor: "Acme" }, { line_items: [{ amount: 1 }] }, { line_items: [{ amount: 2 }] }]
    expect(mergeFieldConfidence(fields, passes, [{}, {}, { line_items: 0.7 }])).toEqual({ line_items: 0.7 })
  })

  it("returns an empty object when no pass reported confidence", () => {
    expect(mergeFieldConfidence(fields, [{ vendor: "Acme" }], [{}, {}])).toEqual({})
  })
})

describe("mergeProvenancePasses", () => {
  const fields = parseTemplateFields([
    { key: "vendor", label: "Vendor", type: "string", required: true, instruction: "" },
    { key: "total", label: "Total", type: "number", required: false, instruction: "", mergeStrategy: "last" },
    { key: "line_items", label: "Line items", type: "array", required: false, instruction: "" },
  ])
  const hints = (fieldsPart: Record<string, unknown>, itemsPart: Record<string, unknown> = {}) => ({ fields: fieldsPart, items: itemsPart }) as never

  it("takes each scalar hint from the pass that won the value", () => {
    const passes = [{ vendor: "Acme", total: 9590.25 }, { vendor: "Acme Continued", total: 11287.54 }]
    const provenance = [
      hints({ vendor: { page: 1, quote: "Acme" }, total: { page: 1, quote: "9590" } }),
      hints({ vendor: { page: 2, quote: "Continued" }, total: { page: 3, quote: "11287.54" } }),
    ]
    // total is mergeStrategy "last", so its hint comes from the second pass; vendor from the first.
    expect(mergeProvenancePasses(fields, passes, provenance)).toEqual({
      fields: { vendor: { page: 1, quote: "Acme" }, total: { page: 3, quote: "11287.54" } },
      items: {},
    })
  })

  it("concatenates array hints in pass order, padding each pass to its row count", () => {
    const passes = [{ line_items: [{ amount: 1 }, { amount: 2 }] }, { line_items: [{ amount: 3 }] }]
    // First pass reports a hint only for its first row; second pass reports its one row.
    const provenance = [
      hints({}, { line_items: [{ page: 1, quote: "row1" }] }),
      hints({}, { line_items: [{ page: 2, quote: "row3" }] }),
    ]
    expect(mergeProvenancePasses(fields, passes, provenance).items.line_items).toEqual([
      { page: 1, quote: "row1" },
      null,
      { page: 2, quote: "row3" },
    ])
  })

  it("omits an array field when no pass contributed a usable hint", () => {
    const passes = [{ line_items: [{ amount: 1 }] }]
    expect(mergeProvenancePasses(fields, passes, [hints({}, {})]).items).toEqual({})
  })
})

describe("mergeClassification", () => {
  it("takes the first non-empty value for each key across passes", () => {
    const merged = mergeClassification([
      { docType: "", entity: "Acme", period: "" },
      { docType: "invoice", entity: "Ignored", period: "2026-01" },
    ])
    expect(merged).toEqual({ docType: "invoice", entity: "Acme", period: "2026-01" })
  })

  it("returns empty strings when nothing was classified", () => {
    expect(mergeClassification([{ docType: "", entity: "", period: "" }])).toEqual({ docType: "", entity: "", period: "" })
    expect(mergeClassification([])).toEqual({ docType: "", entity: "", period: "" })
  })
})
