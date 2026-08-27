import { describe, expect, it } from "vitest"
import { findMissingStatementPeriods } from "@/lib/checks/statement-periods"

const period = (start: string, end: string) => ({ periodStart: new Date(start), periodEnd: new Date(end) })

describe("findMissingStatementPeriods", () => {
  it("returns null with fewer than two periods", () => {
    expect(findMissingStatementPeriods([])).toBeNull()
    expect(findMissingStatementPeriods([period("2026-01-01", "2026-01-31")])).toBeNull()
  })

  it("passes when consecutive months are back to back", () => {
    const result = findMissingStatementPeriods([period("2026-01-01", "2026-01-31"), period("2026-02-01", "2026-02-28")])
    expect(result?.status).toBe("pass")
  })

  it("flags a missing month between two statements", () => {
    const result = findMissingStatementPeriods([period("2026-01-01", "2026-01-31"), period("2026-03-01", "2026-03-31")])
    expect(result?.status).toBe("warn")
    expect(result?.detail?.gaps).toHaveLength(1)
  })

  it("is unaffected by the order the periods are given in", () => {
    const forward = findMissingStatementPeriods([period("2026-01-01", "2026-01-31"), period("2026-03-01", "2026-03-31")])
    const backward = findMissingStatementPeriods([period("2026-03-01", "2026-03-31"), period("2026-01-01", "2026-01-31")])
    expect(backward).toEqual(forward)
  })

  it("flags every gap across more than two statements", () => {
    const result = findMissingStatementPeriods([
      period("2026-01-01", "2026-01-31"),
      period("2026-03-01", "2026-03-31"),
      period("2026-05-01", "2026-05-31"),
    ])
    expect(result?.detail?.gaps).toHaveLength(2)
  })

  it("does not flag overlapping or touching periods as a gap", () => {
    const result = findMissingStatementPeriods([period("2026-01-01", "2026-01-31"), period("2026-01-31", "2026-02-28")])
    expect(result?.status).toBe("pass")
  })
})
