import type { SheetColumn, SheetRow } from "@/lib/sheet-derive"
import type { WorkbookSnapshot } from "@/models/spreadsheets"

/** Univer's CellValueType. Inlined rather than imported so this module — which runs on the
 * server, inside a route handler and a page — never pulls the browser-only Univer bundle in. */
const CELL_TYPE = { STRING: 1, NUMBER: 2, BOOLEAN: 3 } as const

/** Below this the extraction is a guess worth a second look, which the grid tints amber. The
 * same threshold the review flow uses. */
const LOW_CONFIDENCE = 0.6

export const SHEET_STYLE_IDS = { header: "dbHeader", low: "dbLowConfidence", missing: "dbMissingRequired" } as const

/** Named styles referenced by id from every cell that needs them, rather than inlined per cell:
 * a 500-row sheet would otherwise carry 500 copies of the same amber fill in its snapshot. */
const SHEET_STYLES = {
  [SHEET_STYLE_IDS.header]: { bl: 1, bg: { rgb: "#F5F5F4" }, cl: { rgb: "#1C1917" } },
  [SHEET_STYLE_IDS.low]: { bg: { rgb: "#FEF3C7" } },
  [SHEET_STYLE_IDS.missing]: { bg: { rgb: "#FEE2E2" } },
}

export type SheetCell = { v?: string | number | boolean; t?: number; s?: string; custom?: Record<string, unknown> }
type Cell = SheetCell
type CellMatrix = Record<number, Record<number, Cell>>

/** A cell's value, in the type Univer will treat as a number rather than as text. Anything
 * structured (a nested object, an unexpanded array) is serialised so the data is at least
 * visible instead of rendering as "[object Object]". */
function toCell(value: unknown): Cell | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "number") return Number.isFinite(value) ? { v: value, t: CELL_TYPE.NUMBER } : null
  if (typeof value === "boolean") return { v: value, t: CELL_TYPE.BOOLEAN }
  if (typeof value === "string") return { v: value, t: CELL_TYPE.STRING }
  return { v: JSON.stringify(value), t: CELL_TYPE.STRING }
}

/** The style a cell earns from how the extraction went: red when a required field came back
 * empty, amber when the model was unsure. This is the confidence signal the old grid showed
 * as a coloured corner, carried into the spreadsheet.
 *
 * Red is also used for a dictated value the recording does not support — a value the model
 * produced with no confidence and no pinnable moment in the audio. That is red rather than amber
 * on purpose: amber says "check this reading", red says "this may not be in the source at all",
 * and a fabricated number is the more dangerous of the two. */
function cellStyle(row: SheetRow, column: SheetColumn, value: unknown): string | undefined {
  if (row.missingRequired.includes(column.fieldKey) && (value === null || value === undefined || value === "")) return SHEET_STYLE_IDS.missing
  if (row.unsupportedFields?.includes(column.fieldKey)) return SHEET_STYLE_IDS.missing
  const confidence = row.fieldConfidence[column.fieldKey]
  return typeof confidence === "number" && confidence < LOW_CONFIDENCE ? SHEET_STYLE_IDS.low : undefined
}

/** One row of cells, keyed by column index, with each cell carrying the document it came from.
 * That `custom` payload is what lets the grid answer "which PDF is this row?" — the source
 * preview, review actions and the assistant all read it back off the cell. */
function rowCells(row: SheetRow, columns: SheetColumn[]): Record<number, Cell> {
  const cells: Record<number, Cell> = {}
  columns.forEach((column, index) => {
    const value = row.values[column.id]
    const cell = toCell(value)
    const style = cellStyle(row, column, value)
    if (!cell && !style) return
    cells[index] = {
      ...(cell ?? {}),
      ...(style ? { s: style } : {}),
      custom: { documentId: row.documentId, filename: row.filename, itemIndex: row.itemIndex, fieldKey: column.fieldKey, itemKey: column.itemKey },
    }
  })
  return cells
}

/** The same row, dense rather than sparse — what the live grid's `setValues` wants when the
 * browser appends freshly extracted rows. Sharing this with the seeding path is the point: a
 * row written live and the same row written on reload have to be identical, or reopening the
 * file would visibly rewrite what the user just watched appear. */
export function buildRowCellArray(row: SheetRow, columns: SheetColumn[]): SheetCell[] {
  const sparse = rowCells(row, columns)
  return columns.map((_, index) => sparse[index] ?? {})
}

const headerCells = (columns: SheetColumn[]): Record<number, Cell> =>
  Object.fromEntries(columns.map((column, index) => [index, { v: column.label, t: CELL_TYPE.STRING, s: SHEET_STYLE_IDS.header }]))

export type SeedSheet = { sheetId: string; name: string; columns: SheetColumn[]; rows: SheetRow[] }

function buildSheet({ sheetId, name, columns, rows }: SeedSheet) {
  const cellData: CellMatrix = { 0: headerCells(columns) }
  rows.forEach((row, index) => { cellData[index + 1] = rowCells(row, columns) })

  return {
    id: sheetId,
    name,
    // Room to keep working past the extracted data, the way a real spreadsheet opens.
    rowCount: Math.max(rows.length + 100, 200),
    columnCount: Math.max(columns.length + 10, 26),
    zoomRatio: 1,
    // Headers stay put while the rows scroll — with one row per line item these get long.
    freeze: { xSplit: 0, ySplit: 1, startRow: 1, startColumn: 0 },
    defaultColumnWidth: 130,
    cellData,
  }
}

/** A complete workbook for a file: one Univer sheet per worksheet, headers in row 1, one row
 * per document or line item under them. */
export function buildWorkbookSnapshot(fileId: string, sheets: SeedSheet[]): WorkbookSnapshot {
  return {
    id: fileId,
    sheetOrder: sheets.map((sheet) => sheet.sheetId),
    sheets: Object.fromEntries(sheets.map((sheet) => [sheet.sheetId, buildSheet(sheet)])),
    styles: SHEET_STYLES,
    resources: [],
  }
}

/** Adds a tab for a worksheet the workbook has never seen — one created after the file was
 * first opened in the grid. Appended last, matching where a new tab appears in the strip. */
export function addSheetToSnapshot(snapshot: WorkbookSnapshot, sheet: SeedSheet): WorkbookSnapshot {
  const sheets = (snapshot.sheets as Record<string, unknown> | undefined) ?? {}
  const order = Array.isArray(snapshot.sheetOrder) ? (snapshot.sheetOrder as string[]) : []
  return {
    ...snapshot,
    sheets: { ...sheets, [sheet.sheetId]: buildSheet(sheet) },
    sheetOrder: order.includes(sheet.sheetId) ? order : [...order, sheet.sheetId],
    // Styles are referenced by id, so a snapshot saved before these existed has to gain them
    // or every tinted cell would render unstyled.
    styles: { ...SHEET_STYLES, ...((snapshot.styles as Record<string, unknown> | undefined) ?? {}) },
  }
}

/** The last row index that has any cell in it, so appended rows land under the user's own work
 * rather than on top of it. */
function lastUsedRow(cellData: CellMatrix): number {
  const indexes = Object.keys(cellData).map(Number).filter((index) => Number.isInteger(index) && Object.keys(cellData[index] ?? {}).length > 0)
  return indexes.length ? Math.max(...indexes) : -1
}

/** Appends freshly extracted rows to a sheet that already exists in the stored workbook.
 *
 * Returns null when the sheet is not in the snapshot — a worksheet whose tab the user deleted
 * from the grid, where silently recreating rows would be worse than doing nothing. */
export function appendRowsToSnapshot(snapshot: WorkbookSnapshot, sheetId: string, columns: SheetColumn[], rows: SheetRow[]): WorkbookSnapshot | null {
  if (!rows.length) return null
  const sheets = snapshot.sheets as Record<string, { cellData?: CellMatrix; rowCount?: number }> | undefined
  const sheet = sheets?.[sheetId]
  if (!sheet) return null

  const cellData: CellMatrix = { ...(sheet.cellData ?? {}) }
  // A sheet whose header row was never written (an empty worksheet seeded before any upload)
  // still needs one, or the first appended row would read as data with no columns.
  if (!Object.keys(cellData[0] ?? {}).length) cellData[0] = headerCells(columns)

  const start = Math.max(lastUsedRow(cellData), 0) + 1
  rows.forEach((row, index) => { cellData[start + index] = rowCells(row, columns) })

  return {
    ...snapshot,
    sheets: { ...sheets, [sheetId]: { ...sheet, cellData, rowCount: Math.max(sheet.rowCount ?? 0, start + rows.length + 100) } },
  }
}
