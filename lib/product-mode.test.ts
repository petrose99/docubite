import { describe, expect, it } from "vitest"
import { assertMode, ProductModeError } from "@/lib/product-mode"

describe("assertMode", () => {
  it("passes when the mode matches", () => {
    expect(() => assertMode("clinical", "clinical")).not.toThrow()
  })

  it("throws ProductModeError naming the required mode when it does not", () => {
    expect(() => assertMode("accounting", "clinical")).toThrow(ProductModeError)
    try {
      assertMode("accounting", "clinical")
    } catch (error) {
      expect(error).toBeInstanceOf(ProductModeError)
      expect((error as ProductModeError).required).toBe("clinical")
    }
  })
})
