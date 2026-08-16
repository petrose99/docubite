import { describe, expect, it } from "vitest"
import { fillFormulaDown } from "./formula-fill"

describe("fillFormulaDown", () => {
  it("leaves a formula alone at zero offset", () => {
    expect(fillFormulaDown("=B2*C2", 0)).toBe("=B2*C2")
  })

  it("shifts relative rows", () => {
    expect(fillFormulaDown("=B2*C2", 5)).toBe("=B7*C7")
  })

  it("shifts ranges and multi-letter columns", () => {
    expect(fillFormulaDown("=SUM(A2:AB2)", 3)).toBe("=SUM(A5:AB5)")
  })

  it("holds anchored rows still", () => {
    expect(fillFormulaDown("=B2*$C$1", 4)).toBe("=B6*$C$1")
    expect(fillFormulaDown("=$B2/B$1", 2)).toBe("=$B4/B$1")
  })

  it("does not touch row numbers inside text", () => {
    expect(fillFormulaDown('=IF(B2="Q1 2024","yes","no")', 1)).toBe('=IF(B3="Q1 2024","yes","no")')
  })

  it("leaves a formula with no references unchanged", () => {
    expect(fillFormulaDown("=TODAY()", 9)).toBe("=TODAY()")
  })
})
