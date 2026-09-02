import { describe, expect, it } from "vitest"
import { fuseSearchResults, parseSearchInput } from "./global-search"

describe("parseSearchInput", () => {
  it("extracts vendor chip", () => {
    const result = parseSearchInput("vendor:acme some text")
    expect(result.text).toBe("some text")
    expect(result.filters).toEqual([{ fieldKey: "supplier_name", op: "contains", value: "acme" }])
  })

  it("extracts amount comparison", () => {
    const result = parseSearchInput("amount>500")
    expect(result.text).toBe("")
    expect(result.filters).toEqual([{ fieldKey: "total_amount", op: "gt", value: 500 }])
  })

  it("extracts date range with ..", () => {
    const result = parseSearchInput("date:2026-01..2026-03")
    expect(result.filters).toHaveLength(2)
    expect(result.filters[0]).toEqual({ fieldKey: "invoice_date", op: "gte", value: "2026-01" })
    expect(result.filters[1]).toEqual({ fieldKey: "invoice_date", op: "lte", value: "2026-03" })
  })

  it("extracts status and type as separate fields", () => {
    const result = parseSearchInput("status:reviewed type:invoice hello")
    expect(result.status).toBe("reviewed")
    expect(result.type).toBe("invoice")
    expect(result.text).toBe("hello")
    expect(result.filters).toHaveLength(0)
  })

  it("handles quoted values", () => {
    const result = parseSearchInput('vendor:"Acme Corp"')
    expect(result.filters).toEqual([{ fieldKey: "supplier_name", op: "contains", value: "Acme Corp" }])
  })

  it("passes through plain text", () => {
    const result = parseSearchInput("just a plain query")
    expect(result.text).toBe("just a plain query")
    expect(result.filters).toHaveLength(0)
  })

  it("handles multiple chips", () => {
    const result = parseSearchInput("vendor:acme amount>=1000 find me")
    expect(result.text).toBe("find me")
    expect(result.filters).toHaveLength(2)
  })
})

describe("fuseSearchResults", () => {
  it("deduplicates documents across sources", () => {
    const items = fuseSearchResults(
      [{ documentId: "d1", filename: "inv.pdf", values: { supplier_name: "Acme" } }],
      [{ documentId: "d1", filename: "inv.pdf", page: 1, bbox: null, snippet: "hello", score: 0.9 }],
      [],
    )
    const docs = items.filter((i) => i.type === "document")
    expect(docs).toHaveLength(1)
    expect(docs[0].score).toBeGreaterThan(1 / 61)
  })

  it("returns snippets separately", () => {
    const items = fuseSearchResults(
      [],
      [{ documentId: "d1", filename: "inv.pdf", page: 2, bbox: [0, 0, 1, 1], snippet: "text here", score: 0.8 }],
      [],
    )
    const snippets = items.filter((i) => i.type === "snippet")
    expect(snippets).toHaveLength(1)
    expect(snippets[0].snippet).toBe("text here")
  })

  it("sorts by score descending", () => {
    const items = fuseSearchResults(
      [
        { documentId: "d1", filename: "a.pdf", values: {} },
        { documentId: "d2", filename: "b.pdf", values: {} },
      ],
      [{ documentId: "d2", filename: "b.pdf", page: 1, bbox: null, snippet: "x", score: 0.5 }],
      [],
    )
    const docs = items.filter((i) => i.type === "document")
    expect(docs[0].documentId).toBe("d2")
  })
})
