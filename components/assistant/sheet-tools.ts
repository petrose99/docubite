import { cellRef, columnLabel, highlightStyle, type PendingChanges } from "@/components/assistant/pending-changes"
import { fillFormulaDown } from "@/lib/formula-fill"
import type { FUniver } from "@univerjs/presets"
import type { FRange, FWorksheet } from "@univerjs/preset-sheets-core"

/** How much of the grid a single read may return. A model that asks for A1:ZZ10000 gets a
 * truncated answer rather than a megabyte of empty cells in its context window. */
const MAX_CELLS = 2000
/** And how much one call may change. A runaway write is worse than a runaway read: the cap keeps
 * a bad tool call to something the undo bar can plausibly put back. */
const MAX_WRITE_CELLS = 2000
/** Rows of sample data offered up front, enough for the model to infer what each column holds. */
const DEFAULT_SAMPLE_ROWS = 10

export type ToolResult = Record<string, unknown>

/** Puts a range on screen: selects it, and scrolls to it.
 *
 * Selecting alone is not enough. The reference the assistant reports is frequently in a column
 * the user cannot see — a new column added past the last one always is — and a selection made
 * off-screen looks, from where the user is sitting, like nothing happened. */
export function focusRange(sheet: FWorksheet, range: string) {
  const target = sheet.getRange(range)
  target.activate()
  sheet.scrollToCell(target.getRow(), target.getColumn())
}

/** Univer's CellValueType, inlined the way lib/sheet-seed.ts does, so a written number is stored
 * as a number rather than as text that merely looks like one. */
const CELL_TYPE = { STRING: 1, NUMBER: 2, BOOLEAN: 3 } as const

type WriteValue = string | number | boolean | null

const valueType = (value: WriteValue) => {
  if (typeof value === "number") return CELL_TYPE.NUMBER
  if (typeof value === "boolean") return CELL_TYPE.BOOLEAN
  if (typeof value === "string") return CELL_TYPE.STRING
  return null
}


/** Tools the assistant calls, executed here in the browser rather than on the server.
 *
 * This is the arrangement Lido uses, and the reason is the workbook: the authoritative version
 * is the one in this tab, including edits the debounced autosave has not written yet. A server
 * that answered from the stored snapshot would be reading a version of the sheet the user is no
 * longer looking at.
 *
 * Everything here is scoped to the workbook this browser already has open, so a malformed or
 * adversarial tool call from the model can only reach data the user is looking at anyway. */
export function createSheetTools(api: FUniver, pending: PendingChanges) {
  const workbook = () => {
    const book = api.getActiveWorkbook()
    if (!book) throw new Error("No workbook is open")
    return book
  }

  const sheetByName = (name?: string): FWorksheet => {
    const book = workbook()
    if (!name) return book.getActiveSheet()
    const match = book.getSheets().find((sheet) => sheet.getSheetName() === name)
    if (!match) throw new Error(`No sheet named "${name}". Available: ${book.getSheets().map((sheet) => sheet.getSheetName()).join(", ")}`)
    return match
  }

  /** One cell written and remembered. The pre-image comes off the grid before anything changes,
   * and the green tint goes on in the same command as the value — one undo entry, one repaint. */
  const writeCell = (sheet: FWorksheet, row: number, column: number, value: WriteValue, formula?: string) => {
    const range: FRange = sheet.getRange(row, column)
    const before = range.getCellData()
    pending.record({
      kind: "cell",
      sheetId: sheet.getSheetId(),
      sheetName: sheet.getSheetName(),
      row,
      column,
      ref: cellRef(row, column),
      before: before ? { ...before } : null,
    })

    const style = highlightStyle(range.getCellStyleData())
    // A formula cell and a literal cell are mutually exclusive: whichever one is being written,
    // the other's fields are nulled so a value never lingers under a new formula.
    range.setValue(formula
      ? { f: formula, v: null, t: null, si: null, p: null, s: style }
      : { v: value, t: valueType(value), f: null, si: null, p: null, s: style })
  }

  return {
    /** What is in this workbook — the first thing the assistant is told to call, so it answers
     * from the real column names rather than guessing them from the question. */
    profile_workbook: ({ sampleRows = DEFAULT_SAMPLE_ROWS }: { sampleRows?: number }): ToolResult => {
      const book = workbook()
      const active = book.getActiveSheet()
      const rows = Math.max(0, Math.min(sampleRows, 25))

      return {
        activeSheet: active.getSheetName(),
        sheets: book.getSheets().map((sheet) => {
          const lastRow = sheet.getLastRow()
          const lastColumn = sheet.getLastColumn()
          const width = Math.max(lastColumn + 1, 1)
          const headers = lastRow >= 0 ? (sheet.getRange(0, 0, 1, width).getValues()[0] ?? []).map((value) => String(value ?? "")) : []
          const sample = lastRow >= 1
            ? sheet.getRange(1, 0, Math.min(rows, lastRow), width).getValues().map((row) => row.map((value) => value ?? null))
            : []
          return { name: sheet.getSheetName(), rowCount: lastRow + 1, columnCount: width, headers, sampleRows: sample }
        }),
      }
    },

    /** A window of cells in A1 notation. Formulas are optional because they roughly double the
     * payload and are only wanted when the question is about how something is calculated. */
    read_range: ({ sheet, range, includeFormulas }: { sheet?: string; range: string; includeFormulas?: boolean }): ToolResult => {
      const target = sheetByName(sheet)
      const cells = target.getRange(range)
      const values = cells.getValues()
      const total = values.length * (values[0]?.length ?? 0)
      const truncated = total > MAX_CELLS

      const rows = truncated ? values.slice(0, Math.max(1, Math.floor(MAX_CELLS / (values[0]?.length || 1)))) : values
      return {
        sheet: target.getSheetName(),
        range,
        values: rows,
        ...(includeFormulas ? { formulas: cells.getFormulas().slice(0, rows.length) } : {}),
        truncated,
      }
    },

    /** Moves the user's selection. The assistant uses this to show which cells its answer is
     * about — the closest thing it has to pointing at the screen. */
    select_range: ({ sheet, range }: { sheet?: string; range: string }): ToolResult => {
      const target = sheetByName(sheet)
      focusRange(target, range)
      return { selected: `${target.getSheetName()}!${range}` }
    },

    /** Scattered cells, each with its own value or formula. What the assistant reaches for when
     * it is filling in a handful of blanks or correcting particular entries. */
    write_cells: ({ sheet, cells }: { sheet?: string; cells: { ref: string; value?: WriteValue; formula?: string }[] }): ToolResult => {
      const target = sheetByName(sheet)
      if (!Array.isArray(cells) || !cells.length) throw new Error("cells must be a non-empty array of {ref, value|formula}")
      if (cells.length > MAX_WRITE_CELLS) throw new Error(`Too many cells (${cells.length}); write at most ${MAX_WRITE_CELLS} at a time`)

      const written = cells.map((cell) => {
        if (!cell?.ref) throw new Error("Every cell needs a ref, e.g. {ref: \"D2\", value: 12}")
        const range = target.getRange(cell.ref)
        writeCell(target, range.getRow(), range.getColumn(), cell.value ?? null, cell.formula)
        return cell.ref
      })

      return { written: written.length, sheet: target.getSheetName(), cells: written }
    },

    /** A rectangle of values from one corner — the cheap way to lay down a table, where
     * write_cells would spend a ref per cell. */
    write_range: ({ sheet, startRef, values }: { sheet?: string; startRef: string; values: WriteValue[][] }): ToolResult => {
      const target = sheetByName(sheet)
      if (!Array.isArray(values) || !values.length || !Array.isArray(values[0])) throw new Error("values must be a non-empty array of rows, e.g. [[1, 2], [3, 4]]")

      const width = Math.max(...values.map((row) => row.length))
      const total = values.length * width
      if (total > MAX_WRITE_CELLS) throw new Error(`Too many cells (${total}); write at most ${MAX_WRITE_CELLS} at a time`)

      const anchor = target.getRange(startRef)
      const startRow = anchor.getRow()
      const startColumn = anchor.getColumn()
      values.forEach((row, rowOffset) => {
        for (let columnOffset = 0; columnOffset < width; columnOffset += 1) {
          const value = row[columnOffset]
          if (value === undefined) continue
          writeCell(target, startRow + rowOffset, startColumn + columnOffset, value)
        }
      })

      const end = cellRef(startRow + values.length - 1, startColumn + width - 1)
      return { written: total, sheet: target.getSheetName(), range: `${cellRef(startRow, startColumn)}:${end}` }
    },

    /** A new column with a header and, optionally, a formula filled down every data row —
     * "add a Line Total column of quantity × price" in one call.
     *
     * Appending past the last column is the default because it disturbs nothing; `afterColumn`
     * inserts, which shifts everything to its right and is only worth it when the user asked for
     * the column to sit somewhere particular. */
    add_column: ({ sheet, header, formula, afterColumn }: { sheet?: string; header: string; formula?: string; afterColumn?: string }): ToolResult => {
      const target = sheetByName(sheet)
      if (!header) throw new Error("add_column needs a header")

      const lastRow = target.getLastRow()
      const lastColumn = target.getLastColumn()

      let column: number
      if (afterColumn) {
        const anchor = target.getRange(`${afterColumn.replace(/\d+/g, "")}1`)
        column = anchor.getColumn() + 1
        target.insertColumns(column, 1)
      } else {
        column = lastColumn + 1
      }
      pending.record({ kind: "column", sheetId: target.getSheetId(), sheetName: target.getSheetName(), column, header })

      // Row 0 is the header row throughout this product — the seeded sheets, the extraction
      // bridge and the export all assume it — so the new column follows the same shape.
      target.getRange(0, column).setValue({ v: header, t: CELL_TYPE.STRING, f: null, si: null, p: null, s: highlightStyle(null) })

      let rowsFilled = 0
      if (formula && lastRow >= 1) {
        // The model writes the formula for the first data row; every row below gets it shifted,
        // exactly as a fill-down would.
        for (let row = 1; row <= lastRow; row += 1) {
          writeCell(target, row, column, null, fillFormulaDown(formula, row - 1))
          rowsFilled += 1
        }
      }

      return { sheet: target.getSheetName(), column: columnLabel(column), header, rowsFilled }
    },

    /** The assistant's full stop. It carries the summary and the list of what changed, which the
     * panel renders as a card of clickable references — so "done" is something the user can
     * check cell by cell rather than take on trust. */
    task_complete: ({ summary }: { summary: string; changes?: unknown[] }): ToolResult => ({ acknowledged: true, summary }),
  }
}

export type SheetToolName = keyof ReturnType<typeof createSheetTools>

/** Tools that change the workbook, and so put the accept/undo bar on screen. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(["write_cells", "write_range", "add_column"])

/** The tools executed here in the browser. The assistant may also be given server-executed tools
 * (e.g. search_documents), whose results arrive through the stream — onToolCall must run and
 * answer ONLY the names in this set, or it would stamp an "Unknown tool" result over a server
 * tool's real result. */
export const SHEET_TOOL_NAMES: ReadonlySet<string> = new Set(["profile_workbook", "read_range", "select_range", "write_cells", "write_range", "add_column", "task_complete"])

/** Runs one tool call and always resolves: a thrown error comes back as a result the model can
 * read and correct from, rather than breaking the stream. Gemini in particular will sometimes
 * invent a sheet name, and the error text is what gets it to retry with a real one. */
export function runSheetTool(api: FUniver, pending: PendingChanges, name: string, input: unknown): ToolResult {
  const tools = createSheetTools(api, pending) as Record<string, (args: never) => ToolResult>
  const tool = tools[name]
  if (!tool) return { error: `Unknown tool "${name}"` }
  try {
    return tool((input ?? {}) as never)
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Tool failed" }
  }
}
