"use client"

import { ExtractPanel } from "@/components/extract/extract-panel"
import type { SheetTemplate, WorkspaceUsage } from "@/components/extract/types"
import { useExtractionProgress } from "@/components/extract/use-extraction-progress"

/** Mounts the extraction panel outside the sheet — from the Home/Files hub (a brand-new file) or
 * a file's own hub page (adding more documents to one that already exists). ExtractPanel itself
 * never touches the Univer API; this just gives it its own status-polling instance instead of the
 * sheet's, since there's no grid here to write finished rows into live. The server reconciles them
 * into the sheet the next time it's opened either way (see models/spreadsheets.ts::ensureFileWorkbook). */
export function ExtractOverlay({ workspaceId, fileId, fileName, template, usage, sheetCount, documentSearchEnabled = false, onClose }: {
  workspaceId: string
  fileId: string
  /** The file's current display name — "untitled" for one just created by this same "Upload"
   * click, or its real name for an existing file getting more documents added. Lets the panel
   * tell those two cases apart before it decides whether to auto-name the file. */
  fileName: string
  template: SheetTemplate | null
  usage: WorkspaceUsage
  sheetCount: number
  documentSearchEnabled?: boolean
  onClose: () => void
}) {
  const { statuses, track } = useExtractionProgress(workspaceId, [], undefined, documentSearchEnabled)

  return <ExtractPanel
    key={template?.id ?? "new"}
    workspaceId={workspaceId}
    fileId={fileId}
    fileName={fileName}
    template={template}
    usage={usage}
    sheetCount={sheetCount}
    statuses={statuses}
    onClose={onClose}
    onDocumentsQueued={track} />
}
