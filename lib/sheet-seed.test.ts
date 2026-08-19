import { describe, expect, it } from "vitest"
import { addSheetToSnapshot, appendRowsToSnapshot, buildRowCellArray, buildWorkbookSnapshot, SHEET_STYLE_IDS } from "@/lib/sheet-seed"
import type { SheetColumn, SheetRow } from "@/lib/sheet-derive"

const columns: SheetColumn[] = [
  { id: "vendor", label: "Supplier", type: "string", fieldKey: "vendor", itemKey: null },
  { id: "total", label: "Total", type: "number", fieldKey: "total", itemKey: null },
]

const row = (overrides: Partial<SheetRow> = {}): SheetRow => ({
  documentId: "doc-1",
  filename: "invoice.pdf",
  itemIndex: null,
  values: { vendor: "Northstar Ltd", total: 2840 },
  fieldConfidence: {},
  missingRequired: [],
  ...overrides,
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sheetOf = (snapshot: Record<string, unknown>, id: string) => (snapshot.sheets as any)[id]
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cellsOf = (snapshot: Record<string, unknown>, id: string) => sheetOf(snapshot, id).cellData as any

describe("buildWorkbookSnapshot", () => {
  it("writes headers into row 1 and one row of data under them", () => {
    const snapshot = buildWorkbookSnapshot("file-1", [{ sheetId: "s1", name: "Invoice", columns, rows: [row()] }])
    const cells = cellsOf(snapshot, "s1")

    expect(snapshot.sheetOrder).toEqual(["s1"])
    expect(cells[0][0].v).toBe("Supplier")
    expect(cells[0][1].v).toBe("Total")
    expect(cells[1][0].v).toBe("Northstar Ltd")
    expect(cells[1][1].v).toBe(2840)
  })

  it("types numbers as numbers so the grid can sum them", () => {
    const snapshot = buildWorkbookSnapshot("file-1", [{ sheetId: "s1", name: "Invoice", columns, rows: [row()] }])
    const cells = cellsOf(snapshot, "s1")

    expect(cells[1][1].t).toBe(2)
    expect(cells[1][0].t).toBe(1)
  })

  it("links every data cell back to the document it was extracted from", () => {
    const snapshot = buildWorkbookSnapshot("file-1", [{ sheetId: "s1", name: "Invoice", columns, rows: [row({ itemIndex: 3 })] }])

    // filename rides along so the sheet can group and filter rows by source document without a lookup.
    expect(cellsOf(snapshot, "s1")[1][0].custom).toEqual({ documentId: "doc-1", filename: "invoice.pdf", itemIndex: 3, fieldKey: "vendor", itemKey: null })
  })

  it("tints a low-confidence value amber and an empty required one red", () => {
    const snapshot = buildWorkbookSnapshot("file-1", [{
      sheetId: "s1",
      name: "Invoice",
      columns,
      rows: [row({ values: { vendor: "Northstar Ltd", total: null }, fieldConfidence: { vendor: 0.2 }, missingRequired: ["total"] })],
    }])
    const cells = cellsOf(snapshot, "s1")

    expect(cells[1][0].s).toBe(SHEET_STYLE_IDS.low)
    expect(cells[1][1].s).toBe(SHEET_STYLE_IDS.missing)
    // A missing value still has to occupy the cell so the tint has something to sit on.
    expect(cells[1][1].v).toBeUndefined()
  })

  it("freezes the header row", () => {
    const snapshot = buildWorkbookSnapshot("file-1", [{ sheetId: "s1", name: "Invoice", columns, rows: [] }])

    expect(sheetOf(snapshot, "s1").freeze).toMatchObject({ ySplit: 1, startRow: 1 })
  })
})

describe("appendRowsToSnapshot", () => {
  const base = () => buildWorkbookSnapshot("file-1", [{ sheetId: "s1", name: "Invoice", columns, rows: [row()] }])

  it("adds new rows below the existing ones", () => {
    const next = appendRowsToSnapshot(base(), "s1", columns, [row({ documentId: "doc-2", values: { vendor: "Acme", total: 10 } })])

    expect(cellsOf(next!, "s1")[1][0].v).toBe("Northstar Ltd")
    expect(cellsOf(next!, "s1")[2][0].v).toBe("Acme")
  })

  it("lands under work the user has already done further down the sheet", () => {
    const snapshot = base()
    // Something the user typed by hand at row 20, well below the extracted rows.
    ;(snapshot.sheets as Record<string, { cellData: Record<number, unknown> }>).s1.cellData[19] = { 0: { v: "my notes", t: 1 } }

    const next = appendRowsToSnapshot(snapshot, "s1", columns, [row({ documentId: "doc-2", values: { vendor: "Acme", total: 10 } })])

    expect(cellsOf(next!, "s1")[19][0].v).toBe("my notes")
    expect(cellsOf(next!, "s1")[20][0].v).toBe("Acme")
  })

  it("declines to touch a sheet the workbook no longer has, rather than resurrecting it", () => {
    expect(appendRowsToSnapshot(base(), "deleted-sheet", columns, [row()])).toBeNull()
  })

  it("does nothing when there is nothing to append", () => {
    expect(appendRowsToSnapshot(base(), "s1", columns, [])).toBeNull()
  })

  it("writes a header row first if the sheet never had one", () => {
    const snapshot = buildWorkbookSnapshot("file-1", [{ sheetId: "s1", name: "Invoice", columns, rows: [] }])
    ;(snapshot.sheets as Record<string, { cellData: Record<number, unknown> }>).s1.cellData = {}

    const next = appendRowsToSnapshot(snapshot, "s1", columns, [row()])

    expect(cellsOf(next!, "s1")[0][0].v).toBe("Supplier")
    expect(cellsOf(next!, "s1")[1][0].v).toBe("Northstar Ltd")
  })
})

describe("buildRowCellArray", () => {
  // The live bridge writes rows through this while the extraction is still running; the seeding
  // path writes the same rows on reload. If they disagreed, reopening the file would visibly
  // rewrite rows the user just watched appear.
  it("produces the same cells the seeded snapshot holds, densely", () => {
    const subject = row({ values: { vendor: "Northstar Ltd", total: null }, fieldConfidence: { vendor: 0.2 }, missingRequired: ["total"] })
    const snapshot = buildWorkbookSnapshot("file-1", [{ sheetId: "s1", name: "Invoice", columns, rows: [subject] }])

    const dense = buildRowCellArray(subject, columns)

    expect(dense).toHaveLength(columns.length)
    expect(dense[0]).toEqual(cellsOf(snapshot, "s1")[1][0])
    expect(dense[1]).toEqual(cellsOf(snapshot, "s1")[1][1])
  })

  it("emits a placeholder for a column with nothing in it, so later columns keep their position", () => {
    const dense = buildRowCellArray(row({ values: {}, fieldConfidence: {}, missingRequired: [] }), columns)

    expect(dense).toEqual([{}, {}])
  })
})

describe("addSheetToSnapshot", () => {
  it("appends a worksheet created after the workbook was first seeded", () => {
    const snapshot = buildWorkbookSnapshot("file-1", [{ sheetId: "s1", name: "Invoice", columns, rows: [] }])

    const next = addSheetToSnapshot(snapshot, { sheetId: "s2", name: "Receipt", columns, rows: [row()] })

    expect(next.sheetOrder).toEqual(["s1", "s2"])
    expect(cellsOf(next, "s2")[1][0].v).toBe("Northstar Ltd")
  })

  it("does not add the same tab twice", () => {
    const snapshot = buildWorkbookSnapshot("file-1", [{ sheetId: "s1", name: "Invoice", columns, rows: [] }])

    const next = addSheetToSnapshot(snapshot, { sheetId: "s1", name: "Invoice", columns, rows: [] })

    expect(next.sheetOrder).toEqual(["s1"])
  })
})
