import { describe, expect, it } from "vitest"
import { sheetToCsv, snapshotToSheets, snapshotToXlsx } from "./sheet-export"

const snapshot = {
  sheetOrder: ["s2", "s1"],
  sheets: {
    s1: {
      id: "s1",
      name: "Receipt",
      cellData: { 0: { 0: { v: "Supplier" } }, 1: { 0: { v: "Acme" } } },
    },
    s2: {
      id: "s2",
      name: "Invoice",
      cellData: {
        0: { 0: { v: "Supplier" }, 1: { v: "Total" }, 2: { v: "Doubled" } },
        1: { 0: { v: "Acme" }, 1: { v: 100 }, 2: { v: 200, f: "=B2*2" } },
        // A row whose first cell is empty: the gap has to survive as a null, not close up.
        2: { 1: { v: 300 } },
      },
    },
  },
}

describe("snapshotToSheets", () => {
  it("follows the tab order rather than object key order", () => {
    expect(snapshotToSheets(snapshot).map((sheet) => sheet.name)).toEqual(["Invoice", "Receipt"])
  })

  it("exports the computed value of a formula, not the formula", () => {
    const [invoice] = snapshotToSheets(snapshot)
    expect(invoice.rows[1]).toEqual(["Acme", 100, 200])
  })

  it("keeps sparse cells in their columns", () => {
    const [invoice] = snapshotToSheets(snapshot)
    expect(invoice.rows[2]).toEqual([null, 300, null])
  })

  it("returns no rows for an empty sheet", () => {
    expect(snapshotToSheets({ sheets: { s1: { id: "s1", name: "Empty", cellData: {} } } })[0].rows).toEqual([])
  })

  it("survives a snapshot with nothing in it", () => {
    expect(snapshotToSheets({})).toEqual([])
  })
})

describe("sheetToCsv", () => {
  it("quotes every cell and leaves gaps empty", () => {
    const [invoice] = snapshotToSheets(snapshot)
    expect(sheetToCsv(invoice).split("\n")[2]).toBe(',"300",')
  })

  it("escapes embedded quotes", () => {
    expect(sheetToCsv({ name: "x", rows: [['He said "no"']] })).toBe('"He said ""no"""')
  })
})

describe("snapshotToXlsx", () => {
  it("writes a workbook with one tab per sheet", async () => {
    const buffer = await snapshotToXlsx(snapshot)
    expect(buffer.byteLength).toBeGreaterThan(0)
  })

  it("still produces a valid file for an empty workbook", async () => {
    const buffer = await snapshotToXlsx({})
    expect(buffer.byteLength).toBeGreaterThan(0)
  })
})
