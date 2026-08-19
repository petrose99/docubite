"use client"

import { deleteDocumentsAction, reprocessDocumentAction, saveExtractionSheetAction, suggestTemplateFieldsAction, uploadDocumentsAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { ColumnChips } from "@/components/extract/column-chips"
import { FileRow } from "@/components/extract/file-row"
import { filesFromDataTransfer } from "@/components/extract/folder-traverse"
import { FolderReport } from "@/components/extract/folder-report"
import { RunDiffDialog } from "@/components/extract/run-diff-dialog"
import type { MatchedShape, SheetTemplate, StagedFile, WorkspaceUsage } from "@/components/extract/types"
import type { TrackedDocumentStatus } from "@/components/extract/use-extraction-progress"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import type { DocumentFieldDefinition } from "@/lib/document-templates"
import { parsePageRange } from "@/lib/page-range"
import { DictationRecorder } from "@/components/dictation/dictation-recorder"
import { ChevronsUpDown, CloudOff, Files, FileUp, GripHorizontal, Loader2, Mail, Sparkles, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

/** Must stay in sync with SUPPORTED_DOCUMENT_TYPES (models/documents.ts), SUPPORTED_AUDIO_TYPES
 * (lib/asr/types.ts) and PROCESSABLE_TYPES (lib/document-processing.ts). The audio half is only
 * offered when dictation is configured — otherwise the upload would be accepted here and refused
 * by the server. */
const DOCUMENT_TYPES = "application/pdf,image/jpeg,image/png,image/webp,image/heic"
const AUDIO_TYPES = "audio/webm,audio/ogg,audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/flac"
const MAX_STAGED_FILES = 100

const usageLabel = (used: number, limit: number) => (limit < 0 ? `${used} used` : `${used} of ${limit}`)

/** A short "3 hours ago"-style label for when a shape was last used, for the same-shape card. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return "recently"
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`
  return new Date(iso).toLocaleDateString()
}

function UsageMeter({ usage }: { usage: WorkspaceUsage }) {
  const percent = usage.documentsLimit > 0 ? Math.min(100, Math.round((usage.documentsUsed / usage.documentsLimit) * 100)) : 0
  return <div className="flex items-center gap-3 border-b px-4 py-2.5 text-xs text-stone-500">
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-stone-200"><div className={`h-full rounded-full ${percent >= 90 ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${Math.max(percent, 4)}%` }} /></div>
    <span>{usageLabel(usage.documentsUsed, usage.documentsLimit)} documents · {usageLabel(usage.aiUsed, usage.aiLimit)} AI extractions</span>
    <span className="ml-auto rounded border border-stone-200 px-1.5 py-0.5 font-medium text-stone-600">{usage.planName}</span>
  </div>
}

/** Lido-style floating extraction panel: draggable, non-modal, so the sheet stays visible
 * behind it and freshly extracted rows appear next to it live. */
export function ExtractPanel({ workspaceId, fileId, template, usage, sheetCount, onClose, onDocumentsQueued, statuses, dictationEnabled = false }: {
  workspaceId: string
  fileId: string
  template: SheetTemplate | null
  usage: WorkspaceUsage
  sheetCount: number
  onClose: () => void
  onDocumentsQueued: (ids: string[]) => void
  statuses: Record<string, TrackedDocumentStatus>
  /** Whether the deployment has speech-to-text configured. Defaults false so audio is only offered
   * where the server can actually process it. */
  dictationEnabled?: boolean
}) {
  const acceptedTypes = dictationEnabled ? `${DOCUMENT_TYPES},${AUDIO_TYPES}` : DOCUMENT_TYPES
  const router = useRouter()
  const sheetBase = `/workspaces/${workspaceId}/files/${fileId}/sheet`

  // Working copy of the sheet being edited; dirty until saved through the action.
  const [name, setName] = useState(template?.name || `Sheet ${sheetCount + 1}`)
  const [fields, setFields] = useState<DocumentFieldDefinition[]>(template?.fields || [])
  const [prompt, setPrompt] = useState(template?.prompt || "")
  const [multiRow, setMultiRow] = useState(template?.multiRow ?? true)
  const [dirty, setDirty] = useState(false)
  const [savedTemplateId, setSavedTemplateId] = useState<string | null>(template?.id ?? null)

  const [staged, setStaged] = useState<StagedFile[]>([])
  const [pageRange, setPageRange] = useState("")
  const [pageRangeError, setPageRangeError] = useState(false)
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirming, setConfirming] = useState<{ kind: "row"; row: StagedFile } | { kind: "all"; count: number } | null>(null)
  // A saved shape the first upload was recognised as, offered before any columns are set up.
  const [matchedShape, setMatchedShape] = useState<MatchedShape | null>(null)
  // The settled document whose run diff is open, if any.
  const [diffDocId, setDiffDocId] = useState<string | null>(null)
  // The most recent multi-file upload, so its folder report can be opened from the header.
  const [lastBatch, setLastBatch] = useState<{ id: string; size: number } | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const autoSuggested = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  // The queued document ids of the last batch and whether its "processed" toast has fired, so a
  // folder of documents announces itself once, when it finishes, rather than on every poll.
  const batchQueuedIds = useRef<string[]>([])
  const batchToasted = useRef(false)

  // Draggable position; starts docked to the top-right like Lido's panel.
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const dragState = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const onDragStart = (event: React.PointerEvent) => {
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    dragState.current = { startX: event.clientX, startY: event.clientY, baseX: rect.left, baseY: rect.top }
    ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
  }
  const clampPosition = (x: number, y: number) => ({
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - 120)),
    y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - 80)),
  })
  const onDragMove = (event: React.PointerEvent) => {
    const drag = dragState.current
    if (!drag) return
    setPosition(clampPosition(drag.baseX + event.clientX - drag.startX, drag.baseY + event.clientY - drag.startY))
  }
  const onDragEnd = () => { dragState.current = null }

  // A panel dragged to the edge would otherwise be stranded off-screen (or sitting on top of
  // the sheet) when the window shrinks.
  useEffect(() => {
    const onResize = () => setPosition((current) => (current ? clampPosition(current.x, current.y) : current))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // webkitdirectory has no typed React prop, so it is set on the element directly. Setting
  // `directory` too covers non-webkit engines that honour the standard name.
  useEffect(() => {
    const input = folderInputRef.current
    if (!input) return
    input.setAttribute("webkitdirectory", "")
    input.setAttribute("directory", "")
  }, [])

  const markDirty = () => setDirty(true)

  // Keep panel rows in sync with the polled processing statuses.
  useEffect(() => {
    setStaged((previous) => previous.map((row) => {
      const polled = row.documentId ? statuses[row.documentId] : undefined
      if (!polled) return row
      // searchable rides along on every settled row; it flips from false to true a beat after
      // extraction finishes, once embedding has run. With document search off it is always false.
      if (polled.status === "queued" || polled.status === "processing") return { ...row, status: "processing" }
      if (polled.status === "failed") return { ...row, status: "failed", error: polled.errorCode?.replaceAll("_", " ") || "Extraction failed" }
      if (polled.status === "needs_review") return { ...row, status: "attention", searchable: polled.searchable }
      if (polled.status === "ready_for_review" || polled.status === "reviewed") return { ...row, status: "done", searchable: polled.searchable }
      return row
    }))
  }, [statuses])

  // Announces a folder (≥3 files) once, when every document in the batch has reached a terminal
  // state, offering the report. A ref guards against re-firing on every subsequent poll.
  useEffect(() => {
    if (!lastBatch || batchToasted.current || lastBatch.size < 3) return
    const ids = batchQueuedIds.current
    const terminal = new Set(["ready_for_review", "reviewed", "needs_review", "failed"])
    if (ids.length && ids.every((id) => terminal.has(statuses[id]?.status ?? ""))) {
      batchToasted.current = true
      toast.success("Folder processed", { description: "See the grouped report, duplicates, and gaps.", action: { label: "View report", onClick: () => setReportOpen(true) } })
    }
  }, [statuses, lastBatch])

  // Revoking from a ref rather than the effect's closure: with an empty dep list the captured
  // `staged` would be the (empty) first-render one, so every later preview URL would leak.
  const stagedRef = useRef(staged)
  stagedRef.current = staged
  useEffect(() => () => { for (const row of stagedRef.current) if (row.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(row.previewUrl) }, [])

  const acceptFile = (file: File) => acceptedTypes.includes(file.type) && file.size > 0

  const addEntries = useCallback((entries: { file: File; relativePath?: string }[]) => {
    const accepted = entries.filter((entry) => acceptFile(entry.file))
    if (!accepted.length) return
    const fingerprint = (file: File) => `${file.name}:${file.size}:${file.lastModified}`
    const alreadyStaged = new Set(stagedRef.current.flatMap((row) => (row.file ? [fingerprint(row.file)] : [])))
    const fresh: { file: File; relativePath?: string }[] = []
    for (const entry of accepted) {
      const key = fingerprint(entry.file)
      if (alreadyStaged.has(key)) continue
      alreadyStaged.add(key)
      fresh.push(entry)
    }
    const skipped = accepted.length - fresh.length
    if (skipped) toast.info(`${skipped} file${skipped === 1 ? " is" : "s are"} already in the list`)
    if (!fresh.length) return
    const room = Math.max(0, MAX_STAGED_FILES - stagedRef.current.length)
    if (fresh.length > room) toast.warning(`Only ${room} more file${room === 1 ? "" : "s"} fit — extract these first`)
    const rows = fresh.slice(0, room).map(({ file, relativePath }): StagedFile => ({
      localId: crypto.randomUUID(), file, filename: file.name, sizeBytes: file.size, mimeType: file.type,
      previewUrl: URL.createObjectURL(file), documentId: null, status: "staged", error: null,
      relativePath: relativePath && relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : undefined,
    }))
    if (!rows.length) return
    setStaged((previous) => [...previous, ...rows])
  }, [acceptFile])

  /** Adds a plain FileList (click-to-upload or the webkitdirectory input), carrying each file's
   * relative folder path when the browser supplies one. */
  const addFiles = useCallback((incoming: FileList | File[]) => {
    addEntries([...incoming].map((file) => ({ file, relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined })))
  }, [addEntries])

  /** A drop may carry folders. When the DataTransfer exposes filesystem entries, walk them so a
   * dropped folder is expanded to its files (with their paths); otherwise fall back to the flat
   * file list. Both the file list and the entries are captured synchronously — the DataTransfer is
   * only valid during the event. */
  const handleDrop = useCallback((dataTransfer: DataTransfer) => {
    const fileArray = Array.from(dataTransfer.files)
    const items = dataTransfer.items
    const canWalk = items && items.length > 0 && typeof (items[0] as unknown as { webkitGetAsEntry?: unknown }).webkitGetAsEntry === "function"
    if (canWalk) {
      filesFromDataTransfer(items, { accept: acceptFile, maxFiles: MAX_STAGED_FILES })
        .then((entries) => addEntries(entries.length ? entries : fileArray.map((file) => ({ file }))))
        .catch(() => addEntries(fileArray.map((file) => ({ file }))))
      return
    }
    addEntries(fileArray.map((file) => ({ file })))
  }, [acceptFile, addEntries])

  // Lido pre-fills columns from the first document without being asked; do the same, but
  // only for a sheet that has no columns yet so an existing setup is never overwritten.
  useEffect(() => {
    const first = staged.find((row) => row.file)
    if (!first || fields.length || autoSuggested.current || aiBusy) return
    autoSuggested.current = true
    void runSuggestion(first, undefined)
  }, [staged]) // eslint-disable-line react-hooks/exhaustive-deps

  async function runSuggestion(row: StagedFile, singleColumn: string | undefined, opts?: { fresh?: boolean }) {
    if (!row.file) return
    setAiBusy(true)
    try {
      const formData = new FormData()
      formData.append("file", row.file)
      if (singleColumn) formData.set("singleColumn", singleColumn)
      if (opts?.fresh) formData.set("skipShapeMatch", "1")
      const result = await suggestTemplateFieldsAction(workspaceId, formData)
      if (!result.success || !result.data) { toast.error(result.error || "Suggestion failed"); return }
      // A recognised shape short-circuits the LLM: offer it as a card instead of applying columns,
      // but only for a fresh sheet — a panel that already has columns just carries on.
      if (result.data.matchedShape && !singleColumn && !fields.length) { setMatchedShape(result.data.matchedShape); return }
      const suggestion = result.data.suggestion
      if (!suggestion) return
      if (singleColumn) {
        const taken = new Set(fields.map((field) => field.key))
        const fresh = suggestion.fields.filter((field) => !taken.has(field.key))
        if (!fresh.length) { toast.info("That column already exists") ; return }
        setFields((previous) => [...previous, ...fresh.slice(0, 1)])
      } else {
        const taken = new Set(fields.map((field) => field.key))
        const fresh = suggestion.fields.filter((field) => !taken.has(field.key))
        setFields((previous) => [...previous, ...fresh])
        if (suggestion.prompt && !prompt.trim()) setPrompt(suggestion.prompt)
        if (suggestion.name && !template && name.startsWith("Sheet ")) setName(suggestion.name)
        toast.success("Columns suggested from your document", { description: "Review the chips, then process your files." })
      }
      markDirty()
    } catch {
      toast.error("Could not reach the server — no columns were suggested")
    } finally { setAiBusy(false) }
  }

  /** Applies a recognised shape's whole setup to the panel — the point of the "same as last time"
   * offer is that one click reproduces the columns, prompt, and row mode of the last run. */
  const useMatchedShape = () => {
    if (!matchedShape) return
    setFields(matchedShape.fields)
    setPrompt(matchedShape.prompt)
    setMultiRow(matchedShape.multiRow)
    if (!template && name.startsWith("Sheet ")) setName(matchedShape.name)
    setMatchedShape(null)
    markDirty()
  }

  /** Declines the offer and asks the LLM for a fresh setup instead, forcing past the match. */
  const startFresh = () => {
    setMatchedShape(null)
    const first = staged.find((row) => row.file)
    if (first) void runSuggestion(first, undefined, { fresh: true })
  }

  const validatePageRange = (value: string) => {
    try { parsePageRange(value); setPageRangeError(false); return true } catch { setPageRangeError(true); return false }
  }

  async function ensureSheetSaved(): Promise<string | null> {
    if (savedTemplateId && !dirty) return savedTemplateId
    if (!fields.length) { toast.error("Add at least one column first"); return null }
    const result = await saveExtractionSheetAction(workspaceId, fileId, savedTemplateId, { name: name.trim() || "Sheet", fields, prompt, multiRow })
    if (!result.success || !result.data) { toast.error(result.error || "Could not save the sheet"); return null }
    setSavedTemplateId(result.data.templateId)
    setDirty(false)
    if (!template || template.code !== result.data.code) router.replace(`${sheetBase}?template=${result.data.code}`)
    return result.data.templateId
  }

  async function uploadRows(rows: StagedFile[]) {
    if (!rows.length) return
    if (!validatePageRange(pageRange)) { toast.error("Check the page range — e.g. 1-3,5"); return }
    setBusy(true)
    try {
      const templateId = await ensureSheetSaved()
      if (!templateId) return
      // One batch id ties a multi-file run together so it can be reported on as a folder.
      const batchId = rows.length > 1 ? crypto.randomUUID() : null
      const queued: string[] = []
      for (const row of rows) {
        if (!row.file) continue
        setStaged((previous) => previous.map((current) => (current.localId === row.localId ? { ...current, status: "uploading", error: null } : current)))
        const formData = new FormData()
        formData.append("files", row.file)
        formData.set("templateId", templateId)
        formData.set("pageRange", pageRange.trim())
        if (batchId) formData.set("uploadBatchId", batchId)
        // Per-file so one failed upload never aborts the rest of the batch.
        let uploaded: { id: string; filename: string; duplicate: boolean } | undefined
        let failure: string | null = null
        try {
          const result = await uploadDocumentsAction(workspaceId, fileId, formData)
          uploaded = result.success ? result.data?.documents[0] : undefined
          if (!uploaded) failure = result.error || "Upload failed"
        } catch {
          failure = "Could not reach the server"
        }
        setStaged((previous) => previous.map((current) => {
          if (current.localId !== row.localId) return current
          if (!uploaded) return { ...current, status: "failed", error: failure }
          return { ...current, documentId: uploaded.id, status: uploaded.duplicate ? "duplicate" : "queued" }
        }))
        if (!uploaded) continue
        if (!uploaded.duplicate) queued.push(uploaded.id)
      }
      if (queued.length) onDocumentsQueued(queued)
      if (batchId) { setLastBatch({ id: batchId, size: rows.length }); batchQueuedIds.current = queued; batchToasted.current = false }
    } catch {
      toast.error("Upload failed — please try again")
    } finally { setBusy(false) }
  }

  const processable = staged.filter((row) => row.status === "staged" || (row.status === "failed" && !row.documentId))

  const reprocess = async (row: StagedFile) => {
    if (!row.documentId) return
    try {
      const result = await reprocessDocumentAction(workspaceId, fileId, row.documentId)
      if (!result.success) { toast.error(result.error || "Re-process failed"); return }
      setStaged((previous) => previous.map((current) => (current.localId === row.localId ? { ...current, status: "queued", error: null } : current)))
      onDocumentsQueued([row.documentId])
    } catch {
      toast.error("Could not reach the server — nothing was re-processed")
    }
  }

  const dropRowLocally = (row: StagedFile) => {
    if (row.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(row.previewUrl)
    setStaged((previous) => previous.filter((current) => current.localId !== row.localId))
  }

  /** Staged-only rows disappear immediately; anything already uploaded asks first, because
   * removing it deletes the stored document and its extracted rows for good. */
  const removeRow = (row: StagedFile) => {
    if (row.documentId) { setConfirming({ kind: "row", row }); return }
    dropRowLocally(row)
  }

  const resetAll = () => {
    for (const row of stagedRef.current) if (row.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(row.previewUrl)
    setStaged([])
  }

  const uploadedIds = staged.flatMap((row) => (row.documentId ? [row.documentId] : []))

  const requestDeleteAll = () => {
    if (!uploadedIds.length) { resetAll(); return }
    setConfirming({ kind: "all", count: uploadedIds.length })
  }

  const confirmDelete = async () => {
    if (!confirming) return
    const ids = confirming.kind === "row" ? (confirming.row.documentId ? [confirming.row.documentId] : []) : uploadedIds
    setDeleting(true)
    try {
      if (ids.length) {
        const result = await deleteDocumentsAction(workspaceId, fileId, ids)
        if (!result.success) { toast.error(result.error || "Delete failed"); return }
        toast.success(`${ids.length} document${ids.length === 1 ? "" : "s"} deleted`)
      }
      if (confirming.kind === "row") dropRowLocally(confirming.row)
      else resetAll()
      setConfirming(null)
      router.refresh()
    } catch {
      toast.error("Could not reach the server — nothing was deleted")
    } finally { setDeleting(false) }
  }

  const inputClass = "w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500"
  const tabs = [
    { label: "Upload", icon: FileUp, active: true },
    { label: "Google Drive", icon: CloudOff, active: false },
    { label: "OneDrive", icon: CloudOff, active: false },
    { label: "Email", icon: Mail, active: false },
  ]

  return <div ref={panelRef} className="fixed z-50 flex max-h-[calc(100vh-6rem)] w-[26.5rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-2xl" style={position ? { left: position.x, top: position.y } : { right: 24, top: 88 }}>
    <div className="flex cursor-grab touch-none justify-center pt-1.5 text-stone-300 active:cursor-grabbing" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd}><GripHorizontal className="h-4 w-4" /></div>
    <div className="flex items-start justify-between gap-3 px-4 pb-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700"><FileUp className="h-5 w-5" /></div>
        <div>
          <h2 className="text-base font-bold leading-tight text-stone-900">Extract Data</h2>
          <input aria-label="Sheet name" className="mt-0.5 w-44 truncate rounded border border-transparent bg-transparent px-1 py-0 text-xs text-stone-500 hover:border-stone-200 focus:border-stone-300 focus:outline-none" value={name} onChange={(event) => { setName(event.target.value); markDirty() }} />
        </div>
      </div>
      <div className="flex items-center gap-1">
        {lastBatch && <button type="button" onClick={() => setReportOpen(true)} className="inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50" title="Folder report"><Files className="h-3.5 w-3.5" />Report</button>}
        <button type="button" className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700" onClick={onClose} aria-label="Close"><X className="h-5 w-5" /></button>
      </div>
    </div>

    <div className="flex gap-1 border-b px-4">
      {tabs.map((tab) => <button key={tab.label} type="button" disabled={!tab.active} title={tab.active ? undefined : "Coming soon"} className={`relative -mb-px inline-flex items-center gap-1.5 border-b-2 px-2.5 pb-2 pt-1 text-sm font-medium ${tab.active ? "border-emerald-600 text-emerald-700" : "border-transparent text-stone-400"}`}>
        {tab.label}
        {!tab.active && <span className="rounded bg-stone-100 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-stone-400">Soon</span>}
      </button>)}
    </div>

    <UsageMeter usage={usage} />

    <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
      {matchedShape && !fields.length && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-emerald-900">Looks like a {matchedShape.name}</p>
              <p className="mt-0.5 text-xs text-emerald-800">
                {matchedShape.lastFilename ? `Same columns as ${matchedShape.lastFilename}, ${relativeTime(matchedShape.lastRunAt)}?` : `You set this up ${relativeTime(matchedShape.lastRunAt)}. Reuse the same columns?`}
              </p>
            </div>
          </div>
          <div className="mt-2.5 flex gap-2">
            <button type="button" onClick={useMatchedShape} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700">Use same setup</button>
            <button type="button" onClick={startFresh} className="rounded-md px-3 py-1.5 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100">Start fresh</button>
          </div>
        </div>
      )}

      <section>
        <h3 className="text-sm font-bold text-stone-900">Files</h3>
        <p className="mb-2 text-xs text-stone-500">Upload up to {MAX_STAGED_FILES} files at a time to extract data from (PDF{dictationEnabled ? ", image or audio" : " or image"})</p>
        {dictationEnabled && <div className="mb-3">
          {/* A dictation is staged exactly like an uploaded file — it becomes a Document, and the
              transcribe job takes it from there — so it flows through the same review and
              extraction UI rather than needing a parallel one. */}
          <DictationRecorder
            workspaceId={workspaceId}
            disabled={busy}
            onComplete={({ blob, mimeType }) => {
              const extension = mimeType.split("/")[1]?.replace("x-", "") || "webm"
              addFiles([new File([blob], `dictation-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`, { type: mimeType })])
            }} />
        </div>}
        {staged.length > 0 && <div className="mb-2 max-h-64 space-y-0.5 overflow-y-auto pr-1">
          {staged.map((row) => <FileRow key={row.localId} staged={row} busy={busy} sourceUrl={row.documentId ? `/api/documents/${row.documentId}/source` : null} onExtract={() => void uploadRows([row])} onReprocess={() => void reprocess(row)} onRemove={() => removeRow(row)} onDiff={row.documentId ? () => setDiffDocId(row.documentId) : undefined} />)}
        </div>}
        <button type="button" className={`flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-7 text-sm transition-colors ${dragOver ? "border-emerald-500 bg-emerald-50" : "border-stone-300 bg-stone-50/50 hover:border-emerald-400 hover:bg-emerald-50/50"}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => { event.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => { event.preventDefault(); setDragOver(false); handleDrop(event.dataTransfer) }}>
          <FileUp className="h-5 w-5 text-stone-400" />
          <span><span className="font-semibold text-emerald-700">Click to upload</span> <span className="text-stone-500">or drag and drop</span></span>
          <button type="button" className="text-xs font-medium text-stone-400 hover:text-emerald-700" onClick={(event) => { event.stopPropagation(); folderInputRef.current?.click() }}>or upload a whole folder</button>
        </button>
        <input ref={inputRef} type="file" multiple className="hidden" accept={acceptedTypes} onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = "" }} />
        <input ref={folderInputRef} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = "" }} />
        <div className="mt-2.5 flex items-center gap-4 text-sm">
          <button type="button" className="font-medium text-stone-400 hover:text-stone-600 disabled:opacity-50" disabled={!staged.length || busy} onClick={resetAll}>Reset all files</button>
          <button type="button" className="font-medium text-red-500 hover:text-red-700 disabled:opacity-50" disabled={!staged.length || busy || deleting} onClick={requestDeleteAll}>Delete all files</button>
        </div>
        <button type="button" className="mt-2.5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:pointer-events-none disabled:opacity-50" disabled={busy || !processable.length || !fields.length} onClick={() => void uploadRows(processable)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Process all files{processable.length > 1 ? ` (${processable.length})` : ""}
        </button>
        {!fields.length && staged.length > 0 && <p className="mt-1.5 text-xs text-stone-400">{aiBusy ? "Analyzing your document to suggest columns…" : "Add at least one column below before processing."}</p>}
      </section>

      <section>
        <h3 className="text-sm font-bold text-stone-900">Columns</h3>
        <p className="mb-2 text-xs text-stone-500">Each column is one data point the AI extracts. Click a chip to refine it.</p>
        <ColumnChips fields={fields} aiBusy={aiBusy} aiReady={staged.some((row) => row.file)} onChange={(next) => { setFields(next); markDirty() }} onAiSuggest={() => { const first = staged.find((row) => row.file); if (first) void runSuggestion(first, undefined, { fresh: true }) }} onAiColumn={(description) => { const first = staged.find((row) => row.file); if (first) void runSuggestion(first, description) }} />
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-stone-900">Extra instructions</h3>
          <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-700" onClick={() => setPromptExpanded((value) => !value)}><ChevronsUpDown className="h-3.5 w-3.5" />{promptExpanded ? "Collapse" : "Expand"} editor</button>
        </div>
        <p className="mb-2 text-xs text-stone-500">Any additional guidance for the extraction</p>
        <textarea className={inputClass} rows={promptExpanded ? 10 : 3} placeholder="e.g. Extract each line item as a separate row. Amounts are plain numbers without currency symbols." value={prompt} onChange={(event) => { setPrompt(event.target.value); markDirty() }} />
      </section>

      <section className="space-y-2.5 pb-1">
        <div className="flex items-center gap-2">
          <label className="shrink-0 text-sm font-medium text-stone-700" htmlFor="extract-page-range">Page range:</label>
          <input id="extract-page-range" className={`${inputClass} ${pageRangeError ? "border-red-400 ring-1 ring-red-300" : ""}`} placeholder="Leave blank for all pages, or e.g. 1-3,5" value={pageRange} onChange={(event) => setPageRange(event.target.value)} onBlur={(event) => validatePageRange(event.target.value)} />
        </div>
        {pageRangeError && <p className="text-xs text-red-500">Use page numbers and ranges like 1-3,5</p>}
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-stone-700">
          <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={multiRow} onChange={(event) => { setMultiRow(event.target.checked); markDirty() }} />
          Extract multiple rows per document
        </label>
        <p className="-mt-1 text-xs text-stone-400">One spreadsheet row per line item, with document details repeated.</p>
      </section>
    </div>

    <ConfirmDialog
      open={confirming !== null}
      destructive
      busy={deleting}
      title={confirming?.kind === "all" ? `Delete ${confirming.count} uploaded document${confirming.count === 1 ? "" : "s"}?` : "Delete this document?"}
      description={confirming?.kind === "row"
        ? `${confirming.row.filename} and every row extracted from it will be removed, along with the stored file. This cannot be undone.`
        : "The uploaded files and every row extracted from them will be removed. This cannot be undone."}
      confirmLabel={deleting ? "Deleting…" : "Delete"}
      onConfirm={() => void confirmDelete()}
      onCancel={() => setConfirming(null)} />

    {diffDocId && <RunDiffDialog workspaceId={workspaceId} documentId={diffDocId} onClose={() => setDiffDocId(null)} />}

    {reportOpen && lastBatch && <FolderReport workspaceId={workspaceId} fileId={fileId} uploadBatchId={lastBatch.id} onClose={() => setReportOpen(false)} />}
  </div>
}
