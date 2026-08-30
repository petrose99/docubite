"use client"

import { ExtractOverlay } from "@/components/extract/extract-overlay"
import type { SheetTemplate, WorkspaceUsage } from "@/components/extract/types"
import { Upload } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

/** The file hub's "Upload documents" button: opens the Extract overlay in place, scoped to this
 * file, instead of deep-linking into the (now upload-free) sheet. Also how more documents get
 * added to a file that already has some — there's no other entry point for that anymore. */
export function FileHubUploadButton({ workspaceId, fileId, fileName, template, usage, sheetCount, documentSearchEnabled }: {
  workspaceId: string
  fileId: string
  /** The file's current name — passed through so the overlay only auto-names a file still
   * literally called "untitled", never one already named that's just getting more documents. */
  fileName: string
  template: SheetTemplate | null
  usage: WorkspaceUsage
  sheetCount: number
  documentSearchEnabled: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return <>
    <button type="button" onClick={() => setOpen(true)}
      className="inline-flex items-center gap-2 rounded-md border bg-white px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50">
      <Upload className="h-4 w-4" />Upload documents
    </button>
    {open && <ExtractOverlay
      workspaceId={workspaceId}
      fileId={fileId}
      fileName={fileName}
      template={template}
      usage={usage}
      sheetCount={sheetCount}
      documentSearchEnabled={documentSearchEnabled}
      onClose={() => { setOpen(false); router.refresh() }} />}
  </>
}
