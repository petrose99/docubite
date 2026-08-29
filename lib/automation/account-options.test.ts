import { describe, expect, it } from "vitest"
import { resolveAccountOptions } from "@/lib/automation/account-options"

describe("resolveAccountOptions", () => {
  it("uses the code as the submitted value when present, with a code + name label", () => {
    expect(resolveAccountOptions([{ code: "6000", name: "Printing" }])).toEqual([{ value: "6000", label: "6000 — Printing" }])
  })

  it("falls back to the name for both value and label when there is no code", () => {
    expect(resolveAccountOptions([{ code: null, name: "Printing" }])).toEqual([{ value: "Printing", label: "Printing" }])
  })

  it("returns an empty list for an empty input", () => {
    expect(resolveAccountOptions([])).toEqual([])
  })
})
