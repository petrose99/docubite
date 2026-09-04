import { parseTemplateFields } from "@/lib/document-templates"
import type { MineruBlock, MineruPageSize } from "@/lib/mineru"
import { buildBlocksSidecar, buildDocumentProvenance, normalizeForMatch, remapPages, resolveProvenance, scoreMatch, type Ref } from "@/lib/provenance"
import { describe, expect, it } from "vitest"

describe("normalizeForMatch", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(normalizeForMatch("  Total:  $99.00  USD ")).toBe("total 99 00 usd")
  })
})

describe("scoreMatch", () => {
  it("scores an exact word run as 1", () => {
    expect(scoreMatch("Total 99.00", "Invoice Total 99 00 due now")).toBe(1)
  })

  it("does not let a short token match inside a longer one", () => {
    expect(scoreMatch("9", "99")).toBe(0)
  })

  it("gives partial credit for overlapping word bigrams", () => {
    const score = scoreMatch("line item widget", "the line item was")
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(0.55)
  })

  it("returns 0 for no overlap or empty input", () => {
    expect(scoreMatch("alpha beta", "gamma delta")).toBe(0)
    expect(scoreMatch("", "anything")).toBe(0)
  })
})

const sizes: MineruPageSize[] = [{ page: 1, width: 200, height: 400 }, { page: 2, width: 200, height: 400 }]

describe("resolveProvenance", () => {
  const blocks: MineruBlock[] = [
    { page: 1, bbox: [10, 20, 110, 40], text: "Vendor Acme Corp", type: "text" },
    { page: 1, bbox: [120, 300, 200, 320], text: "Total 99.00 USD", type: "text" },
  ]

  it("pins an accepted quote to its block, normalising the bbox against the page size", () => {
    const ref = resolveProvenance({ page: 1, quote: "Total 99.00" }, 99, blocks, sizes)
    expect(ref).toEqual({ page: 1, bbox: [0.6, 0.75, 1, 0.8], quote: "Total 99.00", blockIndex: 1, score: 1 })
  })

  it("prefers a match on the hinted page over an equal match elsewhere", () => {
    const twoPages: MineruBlock[] = [
      { page: 1, bbox: [0, 0, 10, 10], text: "Total 50", type: "text" },
      { page: 2, bbox: [0, 0, 10, 10], text: "Total 50", type: "text" },
    ]
    expect(resolveProvenance({ page: 2, quote: "Total 50" }, 50, twoPages, sizes)?.page).toBe(2)
    expect(resolveProvenance({ page: 1, quote: "Total 50" }, 50, twoPages, sizes)?.blockIndex).toBe(0)
  })

  it("falls back to matching the value itself when the quote is missing", () => {
    const single: MineruBlock[] = [{ page: 1, bbox: null, text: "Grand total 1234.56", type: "text" }]
    const ref = resolveProvenance({ page: 1, quote: "" }, 1234.56, single, sizes)
    expect(ref).toMatchObject({ page: 1, bbox: null, quote: "Grand total 1234.56", score: 1 })
  })

  it("estimates page sizes from blocks when explicit sizes are missing", () => {
    const ref = resolveProvenance({ page: 1, quote: "Total 99.00" }, 99, blocks, null)
    expect(ref).toMatchObject({ page: 1, blockIndex: 1, score: 1 })
    expect(ref!.bbox).not.toBeNull()
    expect(ref!.bbox!.every((n) => n >= 0 && n <= 1)).toBe(true)
  })

  it("uses the best block bbox even for a below-threshold match", () => {
    const weak: MineruBlock[] = [{ page: 1, bbox: [0, 0, 10, 10], text: "the line item was", type: "text" }]
    const ref = resolveProvenance({ page: 1, quote: "line item widget" }, "line item widget", weak, sizes)
    expect(ref).toMatchObject({ page: 1, blockIndex: 0 })
    expect(ref!.bbox).not.toBeNull()
    expect(ref!.score).toBeGreaterThan(0)
    expect(ref!.score).toBeLessThan(0.55)
  })

  it("narrows the highlight to the matching row inside a table block", () => {
    const tableHtml = "<table><tr><td>Widget A</td><td>100</td></tr><tr><td>Widget B</td><td>200</td></tr><tr><td>Subtotal</td><td>300</td></tr></table>"
    const tableBlocks: MineruBlock[] = [
      { page: 1, bbox: [10, 100, 190, 400], text: tableHtml, type: "table" },
    ]
    const ref = resolveProvenance({ page: 1, quote: "Subtotal 300" }, 300, tableBlocks, sizes)
    expect(ref).not.toBeNull()
    expect(ref!.bbox).not.toBeNull()
    // The table has 3 rows; "Subtotal 300" is in the last row, so the highlight should
    // cover roughly the bottom third, not the whole table.
    const [, y0, , y1] = ref!.bbox!
    const highlightHeight = y1 - y0
    expect(highlightHeight).toBeLessThan(0.5)
  })

  it("degrades to the hinted page when there are no blocks, and null when there is nothing to point at", () => {
    expect(resolveProvenance({ page: 3, quote: "anything" }, "x", null, null)).toEqual({ page: 3, bbox: null, quote: "anything", blockIndex: null, score: 0 })
    expect(resolveProvenance({ page: null, quote: "" }, null, null, null)).toBeNull()
  })
})

describe("remapPages", () => {
  const ref: Ref = { page: 1, bbox: null, quote: "q", blockIndex: null, score: 0 }

  it("remaps MinerU's 1..N onto the original page numbers of the selected range", () => {
    expect(remapPages({ ...ref, page: 1 }, "3-5")?.page).toBe(3)
    expect(remapPages({ ...ref, page: 2 }, "3-5")?.page).toBe(4)
    expect(remapPages({ ...ref, page: 2 }, "3,7")?.page).toBe(7)
  })

  it("leaves the page untouched with no range, a null ref, or an out-of-range page", () => {
    expect(remapPages({ ...ref, page: 2 }, null)?.page).toBe(2)
    expect(remapPages(null, "3-5")).toBeNull()
    expect(remapPages({ ...ref, page: 9 }, "3-5")?.page).toBe(9)
  })
})

describe("buildDocumentProvenance", () => {
  const fields = parseTemplateFields([
    { key: "vendor", label: "Vendor", type: "string", required: true, instruction: "" },
    { key: "line_items", label: "Line items", type: "array", required: false, instruction: "", itemFields: [
      { key: "amount", label: "Amount", type: "number", required: true, instruction: "" },
    ] },
  ])
  const blocks: MineruBlock[] = [
    { page: 1, bbox: [0, 0, 50, 20], text: "Vendor Acme Corp", type: "text" },
    { page: 1, bbox: [0, 30, 50, 50], text: "Widget 10 units", type: "text" },
  ]
  const pageSizes: MineruPageSize[] = [{ page: 1, width: 100, height: 100 }]

  it("resolves scalar and per-row provenance, aligned with the rows and remapped by range", () => {
    const hints = { fields: { vendor: { page: 1, quote: "Vendor Acme" } }, items: { line_items: [{ page: 1, quote: "Widget 10" }, null] } }
    const extraction = { vendor: "Acme", line_items: [{ amount: 10 }, { amount: 20 }] }
    const result = buildDocumentProvenance(fields, hints, extraction, blocks, pageSizes, null)
    expect(result.version).toBe(1)
    expect(result.fields.vendor).toMatchObject({ page: 1, bbox: [0, 0, 0.5, 0.2], blockIndex: 0 })
    expect(result.items.line_items).toHaveLength(2)
    expect(result.items.line_items[0]).toMatchObject({ page: 1, bbox: [0, 0.3, 0.5, 0.5], blockIndex: 1 })
    expect(result.items.line_items[1]).toBeNull()
  })

  it("omits fields and arrays with no locatable source", () => {
    const result = buildDocumentProvenance(fields, { fields: {}, items: {} }, { vendor: "Acme", line_items: [{ amount: 10 }] }, blocks, pageSizes, null)
    expect(result.fields).toEqual({})
    expect(result.items).toEqual({})
  })
})

describe("buildBlocksSidecar", () => {
  it("caps each block's text and carries the page sizes", () => {
    const blocks: MineruBlock[] = [{ page: 1, bbox: [0, 0, 1, 1], text: "x".repeat(5000), type: "text" }]
    const sidecar = buildBlocksSidecar(blocks, [{ page: 1, width: 10, height: 10 }])
    expect(sidecar!.version).toBe(1)
    expect(sidecar!.pages).toEqual([{ page: 1, width: 10, height: 10 }])
    expect(sidecar!.blocks[0].text).toHaveLength(2000)
  })

  it("returns null when there are no blocks", () => {
    expect(buildBlocksSidecar(null, null)).toBeNull()
    expect(buildBlocksSidecar([], null)).toBeNull()
  })
})
