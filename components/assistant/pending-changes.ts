import type { FUniver, ICellData, IStyleData } from "@univerjs/presets"

/** Emerald-100. The tint every cell the assistant touched wears until the user accepts or undoes
 * — Lido's signal for "this is new, look at it before you trust it". */
export const CHANGE_HIGHLIGHT = "#DCFCE7"

/** One reversible thing the assistant did.
 *
 * `cell` carries a pre-image rather than a diff: undo puts the exact cell model back, formula,
 * style, number format and source-document metadata included. A diff would have to reconstruct
 * all of that, and would get the `custom` payload wrong — which is what the source preview and
 * the review flow read.
 *
 * `column` is structural: undoing it deletes the column rather than restoring cells, since the
 * column did not exist to have a pre-image. */
export type PendingChange =
  | { kind: "cell"; sheetId: string; sheetName: string; row: number; column: number; ref: string; before: ICellData | null }
  | { kind: "column"; sheetId: string; sheetName: string; column: number; header: string }

/** Column label for a zero-based index: 0 → A, 26 → AA. */
export function columnLabel(column: number): string {
  let label = ""
  for (let index = column; index >= 0; index = Math.floor(index / 26) - 1) {
    label = String.fromCharCode(65 + (index % 26)) + label
  }
  return label
}

export const cellRef = (row: number, column: number) => `${columnLabel(column)}${row + 1}`

/** Collects pre-images as the tools run.
 *
 * Two rules matter here. A cell is recorded only the first time it is touched, so a model that
 * writes A1, thinks again and rewrites A1 still undoes to what the user had — not to the
 * assistant's own first attempt. And inserting a column shifts every recorded cell to its right,
 * so the stored indices are moved with it; without that, undo after an insert would restore the
 * old values one column off. */
export class PendingChanges {
  private changes: PendingChange[] = []

  record(change: PendingChange) {
    if (change.kind === "cell" && this.changes.some((existing) => existing.kind === "cell" && existing.sheetId === change.sheetId && existing.row === change.row && existing.column === change.column)) {
      return
    }
    if (change.kind === "column") {
      for (const existing of this.changes) {
        if (existing.sheetId === change.sheetId && existing.column >= change.column) existing.column += 1
      }
    }
    this.changes.push(change)
  }

  get size() {
    return this.changes.length
  }

  list(): readonly PendingChange[] {
    return this.changes
  }

  clear() {
    this.changes = []
  }

  /** Puts the workbook back exactly as it was, newest change first — the order matters because a
   * column insert has to come out after the cells written into the sheet around it. */
  undo(api: FUniver) {
    const workbook = api.getActiveWorkbook()
    if (!workbook) return
    for (const change of [...this.changes].reverse()) {
      const sheet = workbook.getSheetBySheetId(change.sheetId)
      if (!sheet) continue
      if (change.kind === "column") {
        sheet.deleteColumn(change.column)
        continue
      }
      const before = change.before
      // Explicit nulls, not omissions: Univer merges a cell write key by key, where undefined
      // keeps the current value and null deletes it. Omitting `f` would leave a formula behind
      // in a cell that never had one.
      sheet.getRange(change.row, change.column).setValue({
        v: before?.v ?? null,
        t: before?.t ?? null,
        f: before?.f ?? null,
        si: before?.si ?? null,
        p: before?.p ?? null,
        s: before?.s ?? null,
        custom: before?.custom ?? null,
      })
    }
    this.clear()
  }

  /** Keeps the values and takes the green off, restoring whatever style the cell had before —
   * an amber low-confidence tint the assistant wrote over comes back. */
  accept(api: FUniver) {
    const workbook = api.getActiveWorkbook()
    if (!workbook) return
    for (const change of this.changes) {
      const sheet = workbook.getSheetBySheetId(change.sheetId)
      if (!sheet) continue
      if (change.kind === "column") {
        // A new column had no style of its own; only the header carries the tint.
        sheet.getRange(0, change.column).setValue({ s: null })
        continue
      }
      sheet.getRange(change.row, change.column).setValue({ s: change.before?.s ?? null })
    }
    this.clear()
  }
}

/** The style a written cell wears while it is pending: whatever it had, plus the green.
 *
 * `s` on a stored cell is often an id into the workbook's style table (the seeded sheets use
 * named styles so 500 rows do not carry 500 copies of the same fill), and an id cannot be spread
 * into an object — in that case the tint stands alone until accept restores the id. */
export function highlightStyle(previous: IStyleData | string | undefined | null): IStyleData {
  const base = previous && typeof previous === "object" ? previous : {}
  return { ...base, bg: { rgb: CHANGE_HIGHLIGHT } }
}
