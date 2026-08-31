"use client"

import { ExtractPanel } from "@/components/extract/extract-panel"
import type { SheetTemplate, WorkspaceUsage } from "@/components/extract/types"
import type { TrackedDocumentStatus } from "@/components/extract/use-extraction-progress"
import { useState } from "react"

/** Mounts the extraction panel outside the sheet — from the Home/Files hub (a brand-new file) or
 * a file's own hub page (adding more documents to one that already exists). ExtractPanel itself
 * never touches the Univer API; this just renders it with a status-polling instance the CALLER
 * owns, instead of one this overlay owned itself. It used to own one directly, but that meant
 * closing the overlay (unmounting it) threw away the poller mid-extraction — a document queued
 * seconds before close would sit "queued" in the underlying list forever, with nothing left
 * polling to notice it finished. The caller's instance lives at a level that survives the overlay
 * closing (and, for the pipeline list, survives switching stage tabs too), so progress keeps
 * updating the page behind it exactly as it would have with the panel still open. The server
 * reconciles finished rows into the sheet the next time it's opened either way (see
 * models/spreadsheets.ts::ensureFileWorkbook).
 *
 * `templates`, when there's more than one worksheet to choose from (the pipeline's shared
 * container file, seeded with every finance document type), drives a "Document type" picker
 * inside the panel — see ExtractPanel. Switching remounts ExtractPanel (the `key` below) so its
 * whole local state (fields, prompt, staged files) resets to the newly selected worksheet's own,
 * rather than mixing one worksheet's setup with another's uploads. `template` is still what a
 * single-worksheet caller (the Files hub, today) passes and needs no picker for. */
export function ExtractOverlay({ workspaceId, fileId, fileName, template, templates, usage, sheetCount, statuses, track, onClose }: {
  workspaceId: string
  fileId: string
  /** The file's current display name — "untitled" for one just created by this same "Upload"
   * click, or its real name for an existing file getting more documents added. Lets the panel
   * tell those two cases apart before it decides whether to auto-name the file. */
  fileName: string
  template: SheetTemplate | null
  /** Every worksheet the caller wants offered as a document-type choice. Defaults to just
   * `template` (or none) when omitted, which is the same as not having a picker at all. */
  templates?: SheetTemplate[]
  usage: WorkspaceUsage
  sheetCount: number
  /** From the caller's own useExtractionProgress() — see the doc comment above for why this
   * isn't instantiated here anymore. */
  statuses: Record<string, TrackedDocumentStatus>
  track: (ids: string[]) => void
  onClose: () => void
}) {
  const choices = templates ?? (template ? [template] : [])
  const [selectedId, setSelectedId] = useState(template?.id ?? choices[0]?.id ?? null)
  const activeTemplate = choices.find((candidate) => candidate.id === selectedId) ?? template ?? null

  return <ExtractPanel
    key={activeTemplate?.id ?? "new"}
    workspaceId={workspaceId}
    fileId={fileId}
    fileName={fileName}
    template={activeTemplate}
    templates={choices.length > 1 ? choices : undefined}
    onSelectTemplate={setSelectedId}
    usage={usage}
    sheetCount={sheetCount}
    statuses={statuses}
    onClose={onClose}
    onDocumentsQueued={track} />
}
