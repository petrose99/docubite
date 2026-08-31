"use client"

import { ExtractOverlay } from "@/components/extract/extract-overlay"
import type { SheetTemplate, WorkspaceUsage } from "@/components/extract/types"
import { useExtractionProgress } from "@/components/extract/use-extraction-progress"
import { Upload } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

/** The file hub's "Upload documents" button: opens the Extract overlay in place, scoped to this
 * file, instead of deep-linking into the (now upload-free) sheet. Also how more documents get
 * added to a file that already has some — there's no other entry point for that anymore. Reused
 * as-is by the pipeline list (components/pipeline/pipeline-shell.tsx), just scoped to the
 * workspace's shared pipeline container file instead of one the user opened.
 *
 * Owns the extraction-progress poller itself rather than leaving it to the overlay: this button
 * doesn't unmount when the overlay closes (or, on the pipeline list, when a stage tab link swaps
 * the page's search params), so a document queued right before someone closes the popup keeps
 * being polled and the underlying list keeps updating as it moves through extraction — closing
 * the popup no longer means losing track of it. */
export function FileHubUploadButton({ workspaceId, fileId, fileName, template, templates, usage, sheetCount, documentSearchEnabled, primary = false }: {
  workspaceId: string
  fileId: string
  /** The file's current name — passed through so the overlay only auto-names a file still
   * literally called "untitled", never one already named that's just getting more documents. */
  fileName: string
  template: SheetTemplate | null
  /** Every worksheet to offer as a "Document type" choice — omit (or pass a single-item array)
   * for a caller with only one worksheet, like the Files hub today. */
  templates?: SheetTemplate[]
  usage: WorkspaceUsage
  sheetCount: number
  documentSearchEnabled: boolean
  /** The pipeline list has no other primary call-to-action on the page, so it renders this as the
   * emerald "main action" button rather than the file hub's secondary white one. */
  primary?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const { statuses, track } = useExtractionProgress(workspaceId, [], undefined, documentSearchEnabled)

  return <>
    <button type="button" onClick={() => setOpen(true)}
      className={primary
        ? "inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
        : "inline-flex items-center gap-2 rounded-md border bg-white px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50"}>
      <Upload className="h-4 w-4" />Upload documents
    </button>
    {open && <ExtractOverlay
      workspaceId={workspaceId}
      fileId={fileId}
      fileName={fileName}
      template={template}
      templates={templates}
      usage={usage}
      sheetCount={sheetCount}
      statuses={statuses}
      track={track}
      onClose={() => { setOpen(false); router.refresh() }} />}
  </>
}
