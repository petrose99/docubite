"use client"

import { UniverSheetLoader } from "@/components/sheet/univer-sheet-loader"
import type { IWorkbookData } from "@univerjs/presets"

/** The guest view of a shared file: the same grid the owner works in, with the file bar
 * replaced by the public header and writes governed by the sharing level.
 *
 * "edit" saves back like the real editor. "interact" leaves the grid fully live but never
 * POSTs, so a guest can try a formula against real numbers without touching the original.
 * "view" locks the cells outright — a grid that accepts typing and then loses it on reload
 * reads as a bug rather than as a permission. */
export function SharedSheet({ fileId, snapshot, rev, editable, locked }: {
  fileId: string
  snapshot: IWorkbookData | null
  rev: number
  editable: boolean
  locked: boolean
}) {
  return <UniverSheetLoader fileId={fileId} snapshot={snapshot} rev={rev} readOnly={locked} persist={editable} />
}
