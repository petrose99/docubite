import { describe, expect, it } from "vitest"
import { isBigcapitalReportType, reportTableToSheet } from "./report-mapper"
import type { BigcapitalReportTable } from "./client"

describe("isBigcapitalReportType", () => {
  it("accepts valid types", () => {
    expect(isBigcapitalReportType("trial-balance-sheet")).toBe(true)
    expect(isBigcapitalReportType("general-ledger")).toBe(true)
    expect(isBigcapitalReportType("profit-loss-sheet")).toBe(true)
  })

  it("rejects unknown types", () => {
    expect(isBigcapitalReportType("made-up")).toBe(false)
    expect(isBigcapitalReportType("")).toBe(false)
  })
})

describe("reportTableToSheet", () => {
  it("flattens nested columns to leaf headers", () => {
    const table: BigcapitalReportTable = {
      columns: [
        { key: "name", label: "Account" },
        { key: "totals", label: "Totals", children: [
          { key: "debit", label: "Debit" },
          { key: "credit", label: "Credit" },
        ]},
      ],
      rows: [],
    }
    const sheet = reportTableToSheet("TB", table)
    expect(sheet.rows[0]).toEqual(["Account", "Debit", "Credit"])
  })

  it("flattens nested rows with indentation", () => {
    const table: BigcapitalReportTable = {
      columns: [
        { key: "name", label: "Account" },
        { key: "amount", label: "Amount" },
      ],
      rows: [
        { cells: [{ key: "name", value: "Assets" }, { key: "amount", value: "$10,000" }], children: [
          { cells: [{ key: "name", value: "Cash" }, { key: "amount", value: "$5,000" }] },
          { cells: [{ key: "name", value: "Receivables" }, { key: "amount", value: "$5,000" }] },
        ]},
        { cells: [{ key: "name", value: "Liabilities" }, { key: "amount", value: "$3,000" }] },
      ],
    }
    const sheet = reportTableToSheet("BS", table)
    expect(sheet.name).toBe("BS")
    expect(sheet.rows).toEqual([
      ["Account", "Amount"],
      ["Assets", "$10,000"],
      ["  Cash", "$5,000"],
      ["  Receivables", "$5,000"],
      ["Liabilities", "$3,000"],
    ])
  })

  it("pads short cell arrays to leaf count", () => {
    const table: BigcapitalReportTable = {
      columns: [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
        { key: "c", label: "C" },
      ],
      rows: [
        { cells: [{ key: "a", value: "only one" }] },
      ],
    }
    const sheet = reportTableToSheet("Test", table)
    expect(sheet.rows[1]).toEqual(["only one", "", ""])
  })

  it("skips rows with no cells", () => {
    const table: BigcapitalReportTable = {
      columns: [{ key: "a", label: "A" }],
      rows: [
        { cells: [{ key: "a", value: "keep" }] },
        { cells: [] },
        { cells: [{ key: "a", value: "also keep" }] },
      ],
    }
    const sheet = reportTableToSheet("Test", table)
    expect(sheet.rows).toEqual([["A"], ["keep"], ["also keep"]])
  })

  it("preserves string values verbatim (no numeric coercion)", () => {
    const table: BigcapitalReportTable = {
      columns: [{ key: "amount", label: "Amount" }],
      rows: [
        { cells: [{ key: "amount", value: "$1,234.56" }] },
        { cells: [{ key: "amount", value: "(500.00)" }] },
      ],
    }
    const sheet = reportTableToSheet("PL", table)
    expect(sheet.rows[1]).toEqual(["$1,234.56"])
    expect(sheet.rows[2]).toEqual(["(500.00)"])
  })

  it("handles null cell values as empty strings", () => {
    const table: BigcapitalReportTable = {
      columns: [{ key: "a", label: "A" }, { key: "b", label: "B" }],
      rows: [
        { cells: [{ key: "a", value: "x" }, { key: "b", value: null }] },
      ],
    }
    const sheet = reportTableToSheet("Test", table)
    expect(sheet.rows[1]).toEqual(["x", ""])
  })
})
