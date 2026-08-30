import type { WorkbookSnapshot } from "@/models/spreadsheets"

/** The provenance lib/sheet-seed.ts stamps on every extracted cell — same shape as SheetCell's
 * `custom`, duplicated here rather than imported so this module stays free of any browser-only
 * dependency the seeding path might grow. */
type CellProvenance = { documentId: string; filename?: string; itemIndex: number | null; fieldKey: string; itemKey: string | null }
type SnapshotCell = { v?: unknown; f?: string; custom?: CellProvenance }
type SnapshotSheet = { cellData?: Record<string, Record<string, SnapshotCell>> }

export type WritebackChange = { documentId: string; fieldKey: string; itemIndex: number | null; itemKey: string | null; newValue: unknown }

type IndexedCell = { row: number; col: number; cell: SnapshotCell; provenance: CellProvenance }

const provenanceKey = (p: CellProvenance) => `${p.documentId}|${p.fieldKey}|${p.itemIndex ?? ""}|${p.itemKey ?? ""}`

/** Every cell in a sheet that carries provenance, keyed by it — the index a save's *old*
 * snapshot is walked through to find what a person might have edited. */
function indexProvenanceCells(sheet: SnapshotSheet | undefined): Map<string, IndexedCell> {
  const index = new Map<string, IndexedCell>()
  const cellData = sheet?.cellData ?? {}
  for (const rowKey of Object.keys(cellData)) {
    for (const colKey of Object.keys(cellData[rowKey])) {
      const cell = cellData[rowKey][colKey]
      const provenance = cell?.custom
      if (!provenance?.documentId) continue
      index.set(provenanceKey(provenance), { row: Number(rowKey), col: Number(colKey), cell, provenance })
    }
  }
  return index
}

const cellAt = (sheet: SnapshotSheet | undefined, row: number, col: number): SnapshotCell | undefined => sheet?.cellData?.[row]?.[col]

const cellValue = (cell: SnapshotCell | undefined): unknown => (cell?.v === undefined ? null : cell.v)

/** Diffs a workbook save against what was stored before it, and returns every field a grid
 * edit actually changed — the write-back seam that keeps analytics, exports, integration pushes
 * and FieldCorrection memory in step with cells a person retyped.
 *
 * Walks the *old* snapshot's provenance-carrying cells, not the new one's: a cell that only
 * exists in the new snapshot is a row `ensureFileWorkbook` just appended from fresh extraction,
 * not an edit, and has no business writing anything back (see models/spreadsheets.ts's
 * reconcile path) — so it is simply never visited here.
 *
 * For each old cell: first look up the same provenance key in the new sheet (rows keep their
 * key across a sort or a manual reorder, so this is robust to both). If that key is gone —
 * typing over a cell can drop Univer's `custom` payload along with the old value — fall back to
 * the same (row, col) position in the new sheet, which is still that same cell unless the row
 * itself was deleted, in which case there is nothing at that position either and the key is
 * skipped: a removed row must not blank the field it removed. A formula cell (`f` present) is
 * always skipped — `=AI()` results are not something a spreadsheet edit should push back into
 * reviewedData. */
export function diffSnapshotsForWriteback(oldSnapshot: WorkbookSnapshot, newSnapshot: WorkbookSnapshot): WritebackChange[] {
  const oldSheets = (oldSnapshot?.sheets ?? {}) as Record<string, SnapshotSheet>
  const newSheets = (newSnapshot?.sheets ?? {}) as Record<string, SnapshotSheet>
  const changes: WritebackChange[] = []

  for (const sheetId of Object.keys(oldSheets)) {
    const newSheet = newSheets[sheetId]
    if (!newSheet) continue // the whole worksheet was deleted — nothing to write back

    const oldIndex = indexProvenanceCells(oldSheets[sheetId])
    const newIndex = indexProvenanceCells(newSheet)

    for (const [key, old] of oldIndex) {
      const matched = newIndex.get(key)
      const newCell = matched?.cell ?? cellAt(newSheet, old.row, old.col)
      if (!newCell) continue // the row is gone — do not blank the field it held

      if (newCell.f) continue // formula results never write back to reviewedData

      const nextValue = cellValue(newCell)
      if (nextValue === cellValue(old.cell)) continue

      changes.push({ documentId: old.provenance.documentId, fieldKey: old.provenance.fieldKey, itemIndex: old.provenance.itemIndex, itemKey: old.provenance.itemKey, newValue: nextValue })
    }
  }

  return changes
}
