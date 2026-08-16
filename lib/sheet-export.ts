import type { WorkbookSnapshot } from "@/models/spreadsheets"
import ExcelJS from "exceljs"

export type ExportCell = string | number | boolean | null
export type ExportSheet = { name: string; rows: ExportCell[][] }

/** A cap on a runaway sheet, matched to the seeding cap in models/spreadsheets.ts. */
const MAX_ROWS = 5000
const MAX_COLUMNS = 200

type SnapshotSheet = {
  id?: string
  name?: string
  cellData?: Record<string, Record<string, { v?: unknown; f?: string; p?: unknown }>>
}

/** Reads a Univer snapshot the way a spreadsheet is read: as a rectangle of values.
 *
 * Values, not formulas. `=AI("classify", B2)` has no meaning in Excel, and neither does a
 * reference to a column the export dropped; what the user saw in the cell is what the file
 * should contain. Univer stores that computed value in `v` alongside the formula, so the export
 * is the same text that was on screen.
 *
 * Exporting from the snapshot rather than from the documents is the point of this module. The
 * sheet is where the user's own work lives — the columns they added, the corrections they made,
 * the totals they wrote — and an export derived from Documents would silently omit all of it. */
export function snapshotToSheets(snapshot: WorkbookSnapshot): ExportSheet[] {
  const sheets = (snapshot?.sheets ?? {}) as Record<string, SnapshotSheet>
  const order = Array.isArray(snapshot?.sheetOrder) ? (snapshot.sheetOrder as string[]) : Object.keys(sheets)

  return order
    .map((sheetId) => sheets[sheetId])
    .filter((sheet): sheet is SnapshotSheet => !!sheet)
    .map((sheet, index) => ({ name: sheet.name || `Sheet${index + 1}`, rows: sheetRows(sheet) }))
}

/** The used range of one sheet, densified. Univer's cellData is sparse and keyed by string
 * indices, so an empty cell is a missing key rather than a null — the gaps have to be filled or
 * every row after a blank cell would shift left. */
function sheetRows(sheet: SnapshotSheet): ExportCell[][] {
  const cellData = sheet.cellData ?? {}
  const rowIndices = Object.keys(cellData).map(Number).filter((index) => Number.isInteger(index) && index >= 0)
  if (!rowIndices.length) return []

  const lastRow = Math.min(Math.max(...rowIndices), MAX_ROWS - 1)
  const lastColumn = Math.min(
    Math.max(...rowIndices.flatMap((row) => Object.keys(cellData[row] ?? {}).map(Number).filter((index) => Number.isInteger(index) && index >= 0)), 0),
    MAX_COLUMNS - 1,
  )

  const rows: ExportCell[][] = []
  for (let row = 0; row <= lastRow; row += 1) {
    const source = cellData[row] ?? {}
    const cells: ExportCell[] = []
    for (let column = 0; column <= lastColumn; column += 1) cells.push(cellValue(source[column]))
    rows.push(cells)
  }
  return rows
}

function cellValue(cell: { v?: unknown; p?: unknown } | undefined): ExportCell {
  if (!cell) return null
  const value = cell.v
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value
  return String(value)
}

/** One .xlsx holding every tab of the workbook, in the order the tabs appear in the grid. */
export async function snapshotToXlsx(snapshot: WorkbookSnapshot): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()

  for (const sheet of snapshotToSheets(snapshot)) {
    // Excel rejects sheet names over 31 characters or containing []:*?/\, and fails the whole
    // file rather than the sheet — a worksheet the user named after a client would otherwise
    // produce a download that will not open.
    const worksheet = workbook.addWorksheet(sheet.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet")
    for (const row of sheet.rows) worksheet.addRow(row)
    // Row 1 is the header row everywhere in this product.
    if (sheet.rows.length) worksheet.getRow(1).font = { bold: true }
  }

  if (!workbook.worksheets.length) workbook.addWorksheet("Sheet1")
  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>
}

const csvCell = (value: ExportCell) => (value === null ? "" : `"${String(value).replaceAll('"', '""')}"`)

export function sheetToCsv(sheet: ExportSheet): string {
  return sheet.rows.map((row) => row.map(csvCell).join(",")).join("\n")
}
