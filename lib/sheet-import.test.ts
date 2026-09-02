import { describe, expect, it } from "vitest"
import { parseCsvToSheet, parseXlsxToSheets, sheetsToSnapshot, ImportLimitError } from "./sheet-import"
import { snapshotToSheets } from "./sheet-export"
import ExcelJS from "exceljs"

describe("parseCsvToSheet", () => {
  it("parses basic CSV", () => {
    const sheet = parseCsvToSheet("Name,Amount\nAcme,100\nBob,200", "test")
    expect(sheet.name).toBe("test")
    expect(sheet.rows).toEqual([
      ["Name", "Amount"],
      ["Acme", 100],
      ["Bob", 200],
    ])
  })

  it("handles quoted fields with commas and newlines", () => {
    const sheet = parseCsvToSheet('"A,B","C\nD"\nE,F', "q")
    expect(sheet.rows[0]).toEqual(["A,B", "C\nD"])
    expect(sheet.rows[1]).toEqual(["E", "F"])
  })

  it("handles escaped quotes", () => {
    const sheet = parseCsvToSheet('"say ""hello""",end', "q")
    expect(sheet.rows[0]).toEqual(['say "hello"', "end"])
  })

  it("handles CRLF line endings", () => {
    const sheet = parseCsvToSheet("a,b\r\nc,d\r\n", "crlf")
    expect(sheet.rows).toEqual([["a", "b"], ["c", "d"]])
  })

  it("coerces booleans and numbers", () => {
    const sheet = parseCsvToSheet("true,false,42,3.14,hello", "types")
    expect(sheet.rows[0]).toEqual([true, false, 42, 3.14, "hello"])
  })

  it("treats empty cells as null", () => {
    const sheet = parseCsvToSheet("a,,c", "nulls")
    expect(sheet.rows[0]).toEqual(["a", null, "c"])
  })
})

describe("parseXlsxToSheets", () => {
  it("round-trips through ExcelJS", async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet("Data")
    ws.addRow(["Name", "Value"])
    ws.addRow(["Acme", 42])
    ws.addRow(["Zed", 99])
    const buffer = await wb.xlsx.writeBuffer()

    const sheets = await parseXlsxToSheets(buffer as ArrayBuffer)
    expect(sheets).toHaveLength(1)
    expect(sheets[0].name).toBe("Data")
    expect(sheets[0].rows[0]).toEqual(["Name", "Value"])
    expect(sheets[0].rows[1]).toEqual(["Acme", 42])
  })

  it("rejects files over 10 MB", async () => {
    const big = new ArrayBuffer(11 * 1024 * 1024)
    await expect(parseXlsxToSheets(big)).rejects.toThrow(ImportLimitError)
  })
})

describe("sheetsToSnapshot", () => {
  it("builds a valid snapshot that round-trips through export", () => {
    const sheets = [{ name: "Test", rows: [["A", "B"], ["x", 1]] as (string | number | boolean | null)[][] }]
    const snapshot = sheetsToSnapshot("file1", sheets)
    expect(snapshot.id).toBe("file1")
    const exported = snapshotToSheets(snapshot)
    expect(exported).toHaveLength(1)
    expect(exported[0].name).toBe("Test")
    expect(exported[0].rows[0]).toEqual(["A", "B"])
    expect(exported[0].rows[1]).toEqual(["x", 1])
  })
})
