import type { ExtractionRows } from "@/app/(app)/workspaces/[workspaceId]/sheet-actions"
import { buildRowCellArray } from "@/lib/sheet-seed"
import type { FUniver } from "@univerjs/presets"

/** Writes freshly extracted rows into the grid the user is looking at, right now.
 *
 * Extraction happens on the server and the workbook is reconciled there on every load, so the
 * rows would arrive eventually either way. This is what makes them arrive *while the Extract
 * panel is still open* — Lido's behaviour, where processing a PDF fills the sheet behind the
 * panel a row at a time instead of after a reload.
 *
 * Appending through the facade rather than by rewriting the snapshot means the write goes
 * through Univer's own command system: undo works on it, and the debounced autosave persists
 * it like any other edit.
 *
 * Returns how many rows were written — 0 when the sheet is not in this workbook, which happens
 * if the user deleted the tab while a document was still processing. */
export function appendExtractionRows(api: FUniver, group: ExtractionRows): number {
  const workbook = api.getActiveWorkbook()
  const sheet = workbook?.getSheetBySheetId(group.sheetId)
  if (!sheet || !group.rows.length || !group.columns.length) return 0

  // getLastRow is the last row with content; row 0 is the header, so the first data row can
  // never be less than 1 even on a sheet whose header has somehow gone missing.
  const start = Math.max(sheet.getLastRow() + 1, 1)
  const values = group.rows.map((row) => buildRowCellArray(row, group.columns))

  sheet.getRange(start, 0, values.length, group.columns.length).setValues(values)
  return values.length
}
