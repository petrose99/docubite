import { describe, expect, it } from "vitest"
import { isValidScope } from "./library-search"

describe("isValidScope", () => {
  it("accepts valid scopes", () => {
    expect(isValidScope("smart")).toBe(true)
    expect(isValidScope("content")).toBe(true)
    expect(isValidScope("filename")).toBe(true)
    expect(isValidScope("supplier")).toBe(true)
    expect(isValidScope("category")).toBe(true)
  })

  it("rejects invalid scopes", () => {
    expect(isValidScope("bogus")).toBe(false)
    expect(isValidScope(undefined)).toBe(false)
    expect(isValidScope("")).toBe(false)
  })
})
