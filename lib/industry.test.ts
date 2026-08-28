import { describe, expect, it } from "vitest"
import { assertMode, IndustryError } from "@/lib/industry"

describe("assertMode", () => {
  it("passes when the mode matches", () => {
    expect(() => assertMode("healthcare", "healthcare")).not.toThrow()
  })

  it("throws IndustryError naming the required mode when it does not", () => {
    expect(() => assertMode("finance", "healthcare")).toThrow(IndustryError)
    try {
      assertMode("finance", "healthcare")
    } catch (error) {
      expect(error).toBeInstanceOf(IndustryError)
      expect((error as IndustryError).required).toBe("healthcare")
    }
  })
})
