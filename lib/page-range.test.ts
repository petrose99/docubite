import { describe, expect, it } from "vitest"
import { formatPageRange, parsePageRange } from "@/lib/page-range"

describe("parsePageRange", () => {
  it("returns null for blank input meaning all pages", () => {
    expect(parsePageRange("")).toBeNull()
    expect(parsePageRange("   ")).toBeNull()
    expect(parsePageRange(null)).toBeNull()
    expect(parsePageRange(undefined)).toBeNull()
  })

  it("parses single pages and ranges, sorted and deduplicated", () => {
    expect(parsePageRange("1-3,5")).toEqual([1, 2, 3, 5])
    expect(parsePageRange("5, 1-3, 2")).toEqual([1, 2, 3, 5])
    expect(parsePageRange("7")).toEqual([7])
    expect(parsePageRange("2 - 4")).toEqual([2, 3, 4])
  })

  it("tolerates trailing commas", () => {
    expect(parsePageRange("1,2,")).toEqual([1, 2])
  })

  it("rejects garbage, zero pages, and reversed ranges", () => {
    expect(() => parsePageRange("a")).toThrow("invalid_page_range")
    expect(() => parsePageRange("1-b")).toThrow("invalid_page_range")
    expect(() => parsePageRange("0")).toThrow("invalid_page_range")
    expect(() => parsePageRange("5-1")).toThrow("invalid_page_range")
    expect(() => parsePageRange("-3")).toThrow("invalid_page_range")
    expect(() => parsePageRange("1--3")).toThrow("invalid_page_range")
  })

  it("rejects absurdly wide ranges", () => {
    expect(() => parsePageRange("1-999999")).toThrow("invalid_page_range")
  })
})

describe("formatPageRange", () => {
  it("collapses consecutive runs", () => {
    expect(formatPageRange([1, 2, 3, 5])).toBe("1-3,5")
    expect(formatPageRange([5, 3, 2, 1, 2])).toBe("1-3,5")
    expect(formatPageRange([7])).toBe("7")
    expect(formatPageRange([])).toBe("")
  })

  it("round-trips through parsePageRange", () => {
    expect(parsePageRange(formatPageRange([1, 2, 3, 5, 9, 10]))).toEqual([1, 2, 3, 5, 9, 10])
  })
})
