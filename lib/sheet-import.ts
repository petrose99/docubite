import ExcelJS from "exceljs"
import { SHEET_STYLE_IDS } from "@/lib/sheet-seed"
import { MAX_SNAPSHOT_BYTES } from "@/models/spreadsheets"
import type { WorkbookSnapshot } from "@/models/spreadsheets"
import { randomUUID } from "crypto"

const CELL_TYPE = { STRING: 1, NUMBER: 2, BOOLEAN: 3 } as const

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_CELLS = 100_000
const MAX_TABS = 20

export class ImportLimitError extends Error {
  constructor(message: string) { super(message); this.name = "ImportLimitError" }
}

export type ImportedSheet = { name: string; rows: (string | number | boolean | null)[][] }

export async function parseXlsxToSheets(buffer: ArrayBuffer): Promise<ImportedSheet[]> {
  if (buffer.byteLength > MAX_FILE_BYTES) throw new ImportLimitError(`File exceeds ${MAX_FILE_BYTES / 1024 / 1024} MB limit`)
  const wb = new ExcelJS.Workbook()
  // ExcelJS accepts ArrayBuffer; the @types lag behind
  await (wb.xlsx as { load(data: ArrayBuffer): Promise<unknown> }).load(buffer)
  const sheets: ImportedSheet[] = []
  let totalCells = 0
  for (const ws of wb.worksheets) {
    if (sheets.length >= MAX_TABS) break
    const rows: ImportedSheet["rows"] = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: (string | number | boolean | null)[] = []
      for (let col = 1; col <= (row.cellCount || 0); col++) {
        const cell = row.getCell(col)
        const v = cell.value
        if (v === null || v === undefined) { cells.push(null); continue }
        if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") { cells.push(v); continue }
        if (v instanceof Date) { cells.push(v.toISOString().slice(0, 10)); continue }
        if (typeof v === "object" && "result" in v) { cells.push(v.result != null ? String(v.result) : null); continue }
        if (typeof v === "object" && "richText" in v) { cells.push((v as { richText: { text: string }[] }).richText.map((r) => r.text).join("")); continue }
        cells.push(String(v))
      }
      rows.push(cells)
      totalCells += cells.length
    })
    if (totalCells > MAX_CELLS) throw new ImportLimitError(`Sheet exceeds ${MAX_CELLS.toLocaleString()} cell limit`)
    sheets.push({ name: ws.name || `Sheet${sheets.length + 1}`, rows })
  }
  return sheets
}

export function parseCsvToSheet(text: string, name: string): ImportedSheet {
  const rows: ImportedSheet["rows"] = []
  let totalCells = 0
  for (const line of splitCsvLines(text)) {
    const cells = parseCsvLine(line)
    rows.push(cells)
    totalCells += cells.length
    if (totalCells > MAX_CELLS) throw new ImportLimitError(`Sheet exceeds ${MAX_CELLS.toLocaleString()} cell limit`)
  }
  return { name, rows }
}

function splitCsvLines(text: string): string[] {
  const lines: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') { inQuotes = !inQuotes; current += ch; continue }
    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      lines.push(current)
      current = ""
      if (ch === "\r" && text[i + 1] === "\n") i++
      continue
    }
    current += ch
  }
  if (current) lines.push(current)
  return lines
}

function parseCsvLine(line: string): (string | number | boolean | null)[] {
  if (line === "") return [null]
  const cells: (string | number | boolean | null)[] = []
  let i = 0
  while (i < line.length) {
    if (line[i] === '"') {
      let value = ""
      i++
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') { value += '"'; i += 2 }
          else { i++; break }
        } else { value += line[i]; i++ }
      }
      cells.push(coerceCsvValue(value))
      if (line[i] === ",") i++
    } else {
      const nextComma = line.indexOf(",", i)
      if (nextComma === -1) {
        cells.push(coerceCsvValue(line.slice(i)))
        i = line.length
      } else {
        cells.push(coerceCsvValue(line.slice(i, nextComma)))
        i = nextComma + 1
        if (i === line.length) cells.push(null)
      }
    }
  }
  return cells
}

function coerceCsvValue(raw: string): string | number | boolean | null {
  if (raw === "") return null
  if (raw === "true") return true
  if (raw === "false") return false
  const num = Number(raw)
  if (raw.trim() !== "" && Number.isFinite(num) && raw.trim() === String(num)) return num
  return raw
}

type CellData = Record<number, Record<number, { v?: string | number | boolean; t?: number; s?: string }>>

export function sheetsToSnapshot(fileId: string, sheets: ImportedSheet[]): WorkbookSnapshot {
  const sheetEntries: Record<string, unknown> = {}
  const sheetOrder: string[] = []

  for (const sheet of sheets) {
    const sheetId = randomUUID()
    sheetOrder.push(sheetId)

    const cellData: CellData = {}
    const headerRow: CellData[number] = {}
    if (sheet.rows.length > 0) {
      sheet.rows[0].forEach((val, col) => {
        if (val != null) headerRow[col] = { v: String(val), t: CELL_TYPE.STRING, s: SHEET_STYLE_IDS.header }
      })
      cellData[0] = headerRow
    }

    for (let rowIdx = 1; rowIdx < sheet.rows.length; rowIdx++) {
      const row = sheet.rows[rowIdx]
      const rowCells: CellData[number] = {}
      row.forEach((val, col) => {
        if (val === null) return
        if (typeof val === "number") rowCells[col] = { v: val, t: CELL_TYPE.NUMBER }
        else if (typeof val === "boolean") rowCells[col] = { v: val, t: CELL_TYPE.BOOLEAN }
        else rowCells[col] = { v: val, t: CELL_TYPE.STRING }
      })
      if (Object.keys(rowCells).length > 0) cellData[rowIdx] = rowCells
    }

    const maxCol = Math.max(
      ...sheets.flatMap((s) => s.rows.map((r) => r.length)),
      0,
    )

    sheetEntries[sheetId] = {
      id: sheetId,
      name: sheet.name,
      rowCount: Math.max(sheet.rows.length + 100, 200),
      columnCount: Math.max(maxCol + 10, 26),
      zoomRatio: 1,
      freeze: { xSplit: 0, ySplit: 1, startRow: 1, startColumn: 0 },
      defaultColumnWidth: 130,
      cellData,
    }
  }

  const snapshot: WorkbookSnapshot = {
    id: fileId,
    sheetOrder,
    sheets: sheetEntries,
    styles: {
      [SHEET_STYLE_IDS.header]: { bl: 1, bg: { rgb: "#F5F5F4" }, cl: { rgb: "#1C1917" } },
      [SHEET_STYLE_IDS.low]: { bg: { rgb: "#FEF3C7" } },
      [SHEET_STYLE_IDS.missing]: { bg: { rgb: "#FEE2E2" } },
    },
    resources: [],
  }

  const bytes = new TextEncoder().encode(JSON.stringify(snapshot)).length
  if (bytes > MAX_SNAPSHOT_BYTES) throw new ImportLimitError(`Import produces a snapshot larger than ${MAX_SNAPSHOT_BYTES / 1024 / 1024} MB`)

  return snapshot
}
