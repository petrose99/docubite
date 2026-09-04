import { describe, expect, it } from "vitest"
import { paginationWindow } from "@/components/library/library-pagination"

describe("paginationWindow", () => {
  it("shows all pages when total <= 7", () => {
    expect(paginationWindow(1, 5)).toEqual([1, 2, 3, 4, 5])
    expect(paginationWindow(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it("shows ellipsis after first page when current is far from start", () => {
    const result = paginationWindow(6, 10)
    expect(result[0]).toBe(1)
    expect(result[1]).toBe("ellipsis")
    expect(result).toContain(5)
    expect(result).toContain(6)
    expect(result).toContain(7)
    expect(result[result.length - 1]).toBe(10)
  })

  it("shows ellipsis before last page when current is far from end", () => {
    const result = paginationWindow(3, 10)
    expect(result[0]).toBe(1)
    expect(result).toContain(2)
    expect(result).toContain(3)
    expect(result).toContain(4)
    expect(result[result.length - 2]).toBe("ellipsis")
    expect(result[result.length - 1]).toBe(10)
  })

  it("shows both ellipses when current is in the middle", () => {
    const result = paginationWindow(5, 10)
    expect(result[0]).toBe(1)
    expect(result[1]).toBe("ellipsis")
    expect(result).toContain(4)
    expect(result).toContain(5)
    expect(result).toContain(6)
    expect(result[result.length - 2]).toBe("ellipsis")
    expect(result[result.length - 1]).toBe(10)
  })

  it("handles page 1 of many", () => {
    const result = paginationWindow(1, 20)
    expect(result[0]).toBe(1)
    expect(result).toContain(2)
    expect(result[result.length - 1]).toBe(20)
  })

  it("handles last page", () => {
    const result = paginationWindow(20, 20)
    expect(result[0]).toBe(1)
    expect(result[result.length - 1]).toBe(20)
    expect(result).toContain(19)
  })

  it("handles single page", () => {
    expect(paginationWindow(1, 1)).toEqual([1])
  })
})
