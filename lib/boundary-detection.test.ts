import { describe, expect, it } from "vitest"
import { boundariesToPageRanges, detectBoundaries, type PageSignal } from "./boundary-detection"

describe("detectBoundaries", () => {
  it("returns single boundary for single page", () => {
    const pages: PageSignal[] = [{ pageNumber: 1, text: "Invoice #123" }]
    const result = detectBoundaries(pages)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ startPage: 1, endPage: 1 })
  })

  it("detects boundary when page 1 pattern appears mid-document", () => {
    const pages: PageSignal[] = [
      { pageNumber: 1, text: "Invoice #1\nVendor: Acme\nTotal: $500\nPage 1 of 1" },
      { pageNumber: 2, text: "Invoice #2\nVendor: Beta\nPage 1 of 2" },
      { pageNumber: 3, text: "Line items continued\nPage 2 of 2" },
    ]
    const result = detectBoundaries(pages)
    expect(result.length).toBeGreaterThanOrEqual(2)
    expect(result[0].endPage).toBeLessThan(3)
  })

  it("keeps contiguous pages without signals as one segment", () => {
    const pages: PageSignal[] = [
      { pageNumber: 1, text: "Some generic text about quarterly results" },
      { pageNumber: 2, text: "More text about the same quarterly report" },
      { pageNumber: 3, text: "Conclusions from the same report" },
    ]
    const result = detectBoundaries(pages)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ startPage: 1, endPage: 3 })
  })

  it("handles empty pages array", () => {
    expect(detectBoundaries([])).toEqual([{ startPage: 1, endPage: 0, confidence: 1, reason: "single_page" }])
  })

  it("detects boundary on strong start signals", () => {
    const pages: PageSignal[] = [
      { pageNumber: 1, text: "Invoice #100\nAmount Due: $1000\nTotal: $1000" },
      { pageNumber: 2, text: "PURCHASE ORDER\nPO Number: PO-2026-001\nPage 1 of 3" },
      { pageNumber: 3, text: "Item details for PO-2026-001" },
      { pageNumber: 4, text: "Shipping information" },
    ]
    const result = detectBoundaries(pages)
    expect(result.length).toBeGreaterThanOrEqual(2)
  })
})

describe("boundariesToPageRanges", () => {
  it("formats single-page ranges", () => {
    expect(boundariesToPageRanges([
      { startPage: 1, endPage: 1, confidence: 1, reason: "test" },
      { startPage: 2, endPage: 2, confidence: 1, reason: "test" },
    ])).toEqual(["1", "2"])
  })

  it("formats multi-page ranges", () => {
    expect(boundariesToPageRanges([
      { startPage: 1, endPage: 3, confidence: 1, reason: "test" },
      { startPage: 4, endPage: 7, confidence: 1, reason: "test" },
    ])).toEqual(["1-3", "4-7"])
  })
})
