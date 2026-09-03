import type { ImportedSheet } from "@/lib/sheet-import"
import type { BigcapitalReportColumn, BigcapitalReportRow, BigcapitalReportTable } from "./client"

export type BigcapitalReportType = (typeof BIGCAPITAL_REPORTS)[number]["type"]

export const BIGCAPITAL_REPORTS = [
  { type: "trial-balance-sheet", label: "Trial Balance", path: "/api/reports/trial-balance-sheet", supportsDateRange: true },
  { type: "general-ledger", label: "General Ledger", path: "/api/reports/general-ledger", supportsDateRange: true },
  { type: "payable-aging-summary", label: "AP Aging Summary", path: "/api/reports/payable-aging-summary", supportsDateRange: false },
  { type: "receivable-aging-summary", label: "AR Aging Summary", path: "/api/reports/receivable-aging-summary", supportsDateRange: false },
  { type: "profit-loss-sheet", label: "Profit & Loss", path: "/api/reports/profit-loss-sheet", supportsDateRange: true },
  { type: "balance-sheet", label: "Balance Sheet", path: "/api/reports/balance-sheet", supportsDateRange: true },
] as const

export function isBigcapitalReportType(v: string): v is BigcapitalReportType {
  return BIGCAPITAL_REPORTS.some((r) => r.type === v)
}

function flattenColumns(columns: BigcapitalReportColumn[]): string[] {
  const leaves: string[] = []
  for (const col of columns) {
    if (col.children && col.children.length > 0) {
      leaves.push(...flattenColumns(col.children))
    } else {
      leaves.push(col.label)
    }
  }
  return leaves
}

function flattenRows(rows: BigcapitalReportRow[], leafCount: number, depth: number): string[][] {
  const out: string[][] = []
  for (const row of rows) {
    const cells = row.cells
    if (!cells || cells.length === 0) continue
    const line: string[] = []
    for (let i = 0; i < leafCount; i++) {
      const cell = cells[i]
      let val = cell?.value != null ? String(cell.value) : ""
      if (i === 0 && depth > 0) val = "  ".repeat(depth) + val
      line.push(val)
    }
    out.push(line)
    if (row.children && row.children.length > 0) {
      out.push(...flattenRows(row.children, leafCount, depth + 1))
    }
  }
  return out
}

export function reportTableToSheet(name: string, table: BigcapitalReportTable): ImportedSheet {
  const headers = flattenColumns(table.columns)
  const leafCount = headers.length
  const dataRows = flattenRows(table.rows, leafCount, 0)
  return { name, rows: [headers, ...dataRows] }
}
