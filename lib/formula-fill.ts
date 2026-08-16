/** Relative references, the part a fill-down has to move. `$` before the row number anchors it;
 * anything inside double quotes is text and is left alone. */
const REFERENCE = /("[^"]*")|(\$?)([A-Za-z]{1,3})(\$?)(\d+)/g

/** Moves a formula down `offset` rows the way dragging its fill handle would: relative row
 * numbers shift, `$`-anchored ones stay put.
 *
 * This is what lets the assistant add a whole computed column from a single example formula.
 * Asking the model for one formula per row instead costs a call per row and gets the arithmetic
 * wrong somewhere around row forty. */
export function fillFormulaDown(formula: string, offset: number): string {
  if (!offset) return formula
  return formula.replace(REFERENCE, (match, quoted: string, columnAnchor: string, column: string, rowAnchor: string, row: string) => {
    if (quoted || rowAnchor) return match
    return `${columnAnchor}${column}${rowAnchor}${Number(row) + offset}`
  })
}
