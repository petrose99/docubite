"use client"

import { getCellProvenanceAction, getExtractionRowsAction, markDocumentsSheetAppliedAction } from "@/app/(app)/workspaces/[workspaceId]/sheet-actions"
import { AssistantPanel } from "@/components/assistant/assistant-panel"
import { ExtractPanel } from "@/components/extract/extract-panel"
import type { SheetTemplate, WorkspaceUsage } from "@/components/extract/types"
import { useExtractionProgress } from "@/components/extract/use-extraction-progress"
import { FileHeader } from "@/components/files/file-header"
import type { FUniver, IWorkbookData } from "@univerjs/presets"
import { Database, Download, FileText, Sparkles } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { registerAiFormulas } from "./custom-functions"
import { appendExtractionRows } from "./extraction-bridge"
import { FormulaBuilder } from "./formula-builder"
import { SourcePreview, type ProvenanceTarget, type SourceDocument } from "./source-preview"
import type { SaveState } from "./univer-sheet"
import { UniverSheetLoader } from "./univer-sheet-loader"

const SAVE_LABELS: Record<SaveState, string> = { idle: "", saving: "Saving…", saved: "All changes saved", error: "Not saved" }

const ExtractIcon = () => <Database className="h-4 w-4" />
const FormulaIcon = () => <Sparkles className="h-4 w-4" />
const SourceIcon = () => <FileText className="h-4 w-4" />
const DownloadIcon = () => <Download className="h-4 w-4" />

/** The whole sheet surface: a file bar, the assistant docked left, and the grid filling the
 * rest of the window.
 *
 * Lido's spreadsheet is the page rather than a widget on it — chrome is one thin bar, and the
 * grid's own ribbon, formula bar, sheet tabs and zoom fill everything below. Extraction and the
 * assistant are reached from the grid's own toolbar, not from page chrome. */
export function SheetView({ workspaceId, fileId, fileName, linkAccess, snapshot, rev, template, usage, sheetCount, queuedIds, hasRows, readOnly = false }: {
  workspaceId: string
  fileId: string
  fileName: string
  linkAccess: string
  snapshot: IWorkbookData | null
  rev: number
  template: SheetTemplate | null
  usage: WorkspaceUsage
  sheetCount: number
  queuedIds: string[]
  hasRows: boolean
  readOnly?: boolean
}) {
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const [extractOpen, setExtractOpen] = useState(false)
  const [formulaBuilderOpen, setFormulaBuilderOpen] = useState(false)
  const [source, setSource] = useState<SourceDocument | null>(null)
  const [target, setTarget] = useState<ProvenanceTarget | null>(null)
  // The revision the server settled on after absorbing an extraction, handed to the grid so its
  // next save is not rejected by work it effectively did itself.
  const [adoptRev, setAdoptRev] = useState<number | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(!readOnly)
  const apiRef = useRef<FUniver | null>(null)
  const saveNowRef = useRef<(() => Promise<boolean>) | null>(null)

  /** Writes the rows of a just-finished extraction straight into the open grid. The server has
   * them either way — it reconciles on every load — but going through the facade is what makes
   * them appear while the Extract panel is still on screen. */
  const absorbExtraction = useCallback(async (documentIds: string[]) => {
    const api = apiRef.current
    if (!api || readOnly) return
    const result = await getExtractionRowsAction(workspaceId, fileId, documentIds).catch(() => null)
    if (!result?.success || !result.data?.length) return

    const applied = result.data.flatMap((group) => (appendExtractionRows(api, group) > 0 ? group.documentIds : []))
    // Stamped only for what actually landed, so anything that missed (a deleted tab, a sheet
    // not in this workbook) is retried by the next load's reconcile instead of being lost.
    if (!applied.length) return

    // And only once the rows are on the server. Appending through the facade puts them in this
    // browser's copy of the workbook, nothing more; if the save that follows never lands — a
    // failed request, a tab closed in between — a document stamped here would be treated as
    // already in the sheet by every later reconcile, and its rows would be gone for good.
    // Leaving it unstamped costs nothing: the next page load appends it server-side.
    if (!(await saveNowRef.current?.())) return

    const stamped = await markDocumentsSheetAppliedAction(workspaceId, fileId, applied).catch(() => null)
    const settled = stamped?.success ? stamped.data?.rev : null
    if (typeof settled === "number") setAdoptRev(settled)
  }, [fileId, readOnly, workspaceId])

  const { statuses, track } = useExtractionProgress(workspaceId, queuedIds, (ids) => void absorbExtraction(ids))

  // The revision this browser is responsible for. A server revision ahead of it means another
  // tab has edited the file — extraction no longer moves it, since we write those rows here.
  const clientRev = useRef(rev)
  const notifiedRev = useRef(rev)
  useEffect(() => {
    if (rev <= clientRev.current || rev <= notifiedRev.current) return
    notifiedRev.current = rev
    toast.info("This sheet changed elsewhere", { description: "Reload to see the latest version.", action: { label: "Reload", onClick: () => window.location.reload() } })
  }, [rev])

  // The revision the extraction settled on is this tab's now too, so the refreshed page arriving
  // with it is not mistaken for somebody else's edit.
  useEffect(() => {
    if (adoptRev === null) return
    clientRev.current = adoptRev
    notifiedRev.current = adoptRev
  }, [adoptRev])

  // Lido's welcome flow: an empty sheet greets you with the extractor already open.
  const autoOpened = useRef(false)
  useEffect(() => {
    if (autoOpened.current || readOnly || hasRows || queuedIds.length) return
    autoOpened.current = true
    setExtractOpen(true)
  }, [hasRows, queuedIds.length, readOnly])

  /** Opens the document behind whichever cell is selected, scrolled and highlighted to where the
   * value was read from. Reads the pointer off the cell rather than the row, so it works the same
   * in a sheet whose columns have been moved, sorted, or renamed since extraction. */
  const openActiveCellSource = useCallback(async () => {
    const cell = apiRef.current?.getActiveWorkbook()?.getActiveSheet()?.getSelection()?.getActiveRange()?.getCellData()
    const custom = cell?.custom as { documentId?: string; fieldKey?: string; itemIndex?: number | null; itemKey?: string | null } | undefined
    if (!custom?.documentId || !custom.fieldKey) {
      toast.info("No source document for this cell", { description: "Select a cell in a row that came from an extraction." })
      return
    }

    const info = await getCellProvenanceAction(workspaceId, custom.documentId, custom.fieldKey, custom.itemIndex ?? null, custom.itemKey ?? null).catch(() => null)
    if (!info?.success || !info.data) {
      toast.error(info?.error ?? "Could not open the source file")
      return
    }
    setSource({ documentId: custom.documentId, filename: info.data.filename, mimeType: info.data.mimeType })
    setTarget(info.data.ref ? { page: info.data.ref.page, bbox: info.data.ref.bbox, quote: info.data.ref.quote } : null)
  }, [workspaceId])

  const handleReady = useCallback((api: FUniver) => {
    apiRef.current = api
    if (readOnly) return

    /** AI formulas are registered only on an editable grid. A shared read-only link recalculating
     * `=AI(...)` would spend the owner's AI allowance on a visitor's page load; the values
     * saved in the snapshot are what that viewer sees instead. */
    registerAiFormulas(api, workspaceId)

    /** Extract Data goes in the leading toolbar group rather than the trailing one because
     * Univer collapses the toolbar from the right: anything in `ribbon.start.others` is first
     * into the ⋮ overflow on a narrow window, and the primary action of the whole product
     * cannot be the one that hides. */
    api.registerComponent("docubite-extract-icon", ExtractIcon)
    api.createMenu({
      id: "docubite.extract-data",
      title: "Extract Data",
      tooltip: "Upload documents and turn them into rows",
      icon: "docubite-extract-icon",
      order: -1,
      action: () => setExtractOpen(true),
    }).appendTo("ribbon.start.history")

    /** The formula builder belongs on the Formulas tab, next to Univer's own function tools —
     * it is a way of writing a formula, not a separate feature. */
    api.registerComponent("docubite-formula-icon", FormulaIcon)
    api.createMenu({
      id: "docubite.ai-formula",
      title: "AI Formula",
      tooltip: "Describe a calculation and get the formula for it",
      icon: "docubite-formula-icon",
      order: -1,
      action: () => setFormulaBuilderOpen(true),
    }).appendTo("ribbon.formulas.basic")

    /** Download, next to Extract Data: the two ends of the same job, documents in and a
     * spreadsheet out. Navigating rather than fetching so the browser's own download machinery
     * handles the file — the route answers with a content-disposition attachment. */
    api.registerComponent("docubite-download-icon", DownloadIcon)
    api.createMenu({
      id: "docubite.export-xlsx",
      title: "Download",
      tooltip: "Download this spreadsheet as .xlsx",
      icon: "docubite-download-icon",
      order: 0,
      action: () => { window.location.href = `/workspaces/${workspaceId}/files/${fileId}/export?format=xlsx` },
    }).appendTo("ribbon.start.history")

    /** Right-click → Preview source file, on the row's own document.
     *
     * The link from a cell back to its PDF is the `custom` payload lib/sheet-seed.ts writes on
     * every extracted cell; this is the one place in the product that follows it. A cell the
     * user typed themselves has no such payload, which is why the item explains itself rather
     * than doing nothing. */
    api.registerComponent("docubite-source-icon", SourceIcon)

    /** A permanent "View source" button on the Start toolbar, so the traceability is discoverable
     * — a reviewer can see the capability exists without first stumbling on the right-click menu or
     * the selection pill. It opens the document behind the active cell; on a cell that came from no
     * extraction it explains itself with a toast rather than doing nothing. */
    api.createMenu({
      id: "docubite.view-source",
      title: "View source",
      tooltip: "Open the document a cell was extracted from, highlighted at the value",
      icon: "docubite-source-icon",
      order: 1,
      action: () => void openActiveCellSource(),
    }).appendTo("ribbon.start.history")

    api.createMenu({
      id: "docubite.preview-source",
      title: "Preview source file",
      icon: "docubite-source-icon",
      action: () => void openActiveCellSource(),
      // appendTo splits on "|", not on dots: the context menu needs the area and the group as
      // two separate levels, where the ribbon slots above happen to be single keys.
    }).appendTo("contextMenu.mainArea|contextMenu.others")

    /** The assistant toggle sits on the same row as Start / Formulas / Data. `header-menu` is
     * the one UI part Univer renders there; a menu item would have landed in the toolbar
     * below, which is a different row from the one it belongs beside. */
    api.registerUIPart("header-menu" as never, () => (
      <button
        type="button"
        onClick={() => setAssistantOpen((open) => !open)}
        className="mr-2 inline-flex h-7 items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-800 transition-colors hover:border-emerald-300 hover:bg-emerald-100">
        <Sparkles className="h-3.5 w-3.5" />AI Assistant
      </button>
    ))
  }, [fileId, openActiveCellSource, readOnly, workspaceId])

  const label = readOnly ? "Read only" : SAVE_LABELS[saveState]

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-white">
      <FileHeader
        workspaceId={workspaceId}
        fileId={fileId}
        name={fileName}
        linkAccess={linkAccess}
        status={label ? <span className={`text-xs ${saveState === "error" && !readOnly ? "text-destructive" : "text-stone-400"}`}>{label}</span> : null} />

      <div className="flex min-h-0 flex-1">
        {assistantOpen && !readOnly && <AssistantPanel workspaceId={workspaceId} apiRef={apiRef} onClose={() => setAssistantOpen(false)} />}

        <UniverSheetLoader
          fileId={fileId}
          snapshot={snapshot}
          rev={rev}
          readOnly={readOnly}
          onSaveStateChange={setSaveState}
          adoptRev={adoptRev}
          onSaveHandle={(saveNow) => { saveNowRef.current = saveNow }}
          onRevChange={(next) => { clientRev.current = next; notifiedRev.current = next }}
          onReady={handleReady} />
      </div>

      {/* A persistent affordance the whole time a file has extracted rows, so the traceability is
          always on screen — not hidden behind a cell selection, the toolbar overflow, or the
          right-click menu. Select a cell and click it to open that value's source. */}
      {!readOnly && hasRows && !source && (
        <button
          type="button"
          onClick={() => void openActiveCellSource()}
          title="Select a cell that came from a document, then click to open its source, highlighted at the value"
          className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-white px-3.5 py-2 text-xs font-semibold text-emerald-800 shadow-lg transition-colors hover:border-emerald-400 hover:bg-emerald-50">
          <FileText className="h-4 w-4" />View source
        </button>
      )}

      {source && <SourcePreview source={source} target={target} onClose={() => { setSource(null); setTarget(null) }} />}

      {formulaBuilderOpen && !readOnly && <FormulaBuilder workspaceId={workspaceId} apiRef={apiRef} onClose={() => setFormulaBuilderOpen(false)} />}

      {extractOpen && <ExtractPanel
        key={template?.id ?? "new"}
        workspaceId={workspaceId}
        fileId={fileId}
        template={template}
        usage={usage}
        sheetCount={sheetCount}
        statuses={statuses}
        onClose={() => setExtractOpen(false)}
        onDocumentsQueued={track} />}
    </main>
  )
}
