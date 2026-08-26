"use client"

import { DocumentPreview } from "@/components/documents/document-preview"
import type { StagedFile } from "@/components/extract/types"
import { AlertTriangle, Check, Copy, Download, Eye, FileSearch, GitCompare, Loader2, Play, RotateCw, Trash2, X } from "lucide-react"
import { useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

/** "shipping_date" -> "Shipping date" — good enough without a template-field lookup, which
 * would need an extra join just to label a tooltip. */
const formatFieldKey = (key: string) => {
  const words = key.replaceAll("_", " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const flaggedFieldsTitle = (fields: string[]) => `The AI is unsure about, or is missing: ${fields.map(formatFieldKey).join(", ")}`

function StatusBadge({ staged }: { staged: StagedFile }) {
  // A second chip reflecting document-search indexing, next to the extraction status. Extraction
  // finishing does not mean embedding has too (lib/document-processing.ts::kickEmbedJob may run it
  // in a separate invocation) — "Indexing…" makes that gap visible instead of the row just going
  // quiet until the flag flips. Neither renders when document search is off.
  const settled = staged.status === "done" || staged.status === "attention"
  const searchable = settled && staged.searchable
    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-stone-400" title="Indexed for document search — ask the AI Assistant about its contents"><FileSearch className="h-3 w-3" />Searchable</span>
    : settled && staged.indexing
      ? <span className="inline-flex items-center gap-1 text-xs font-medium text-stone-400" title="Being indexed for document search"><Loader2 className="h-3 w-3 animate-spin" />Indexing…</span>
      : null

  const flagged = staged.flaggedFields?.length
    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600" title={flaggedFieldsTitle(staged.flaggedFields)}>
        <AlertTriangle className="h-3 w-3" />{staged.flaggedFields.length} field{staged.flaggedFields.length === 1 ? "" : "s"}
      </span>
    : null

  let status: ReactNode = null
  if (staged.status === "uploading") status = <span className="inline-flex items-center gap-1 text-xs font-medium text-stone-500"><Loader2 className="h-3 w-3 animate-spin" />Uploading</span>
  else if (staged.status === "queued" || staged.status === "processing") status = <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><Loader2 className="h-3 w-3 animate-spin" />Extracting</span>
  else if (staged.status === "done") status = <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><Check className="h-3 w-3" />Done</span>
  else if (staged.status === "attention") status = <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600" title={staged.flaggedFields?.length ? flaggedFieldsTitle(staged.flaggedFields) : undefined}><AlertTriangle className="h-3 w-3" />Review</span>
  else if (staged.status === "failed") status = <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600" title={staged.error || undefined}><X className="h-3 w-3" />Failed</span>
  else if (staged.status === "duplicate") status = <span className="inline-flex items-center gap-1 text-xs font-medium text-stone-500" title="This exact file was already extracted"><Copy className="h-3 w-3" />Already extracted</span>

  // The "Review" badge already implies a missing required field; showing the flagged count next
  // to it would be redundant, so it only rides alongside "Done" — the case where AI-unsure fields
  // exist but nothing blocked review.
  const showFlagged = flagged && staged.status === "done"
  if (!status && !searchable && !showFlagged) return null
  return <span className="inline-flex items-center gap-2">{status}{showFlagged && flagged}{searchable}</span>
}

/** One file in the panel's Files section, mirroring Lido's row: name, status, then eye
 * (preview overlay), download, extract-or-reprocess, and delete controls. */
export function FileRow({ staged, sourceUrl, busy, onExtract, onReprocess, onRemove, onDiff }: {
  staged: StagedFile
  sourceUrl: string | null
  busy: boolean
  onExtract: () => void
  onReprocess: () => void
  onRemove: () => void
  onDiff?: () => void
}) {
  const [preview, setPreview] = useState(false)
  const previewSrc = staged.documentId && sourceUrl ? sourceUrl : staged.previewUrl

  useEffect(() => {
    if (!preview) return
    const close = (event: KeyboardEvent) => event.key === "Escape" && setPreview(false)
    window.addEventListener("keydown", close)
    return () => window.removeEventListener("keydown", close)
  }, [preview])

  const working = staged.status === "uploading" || staged.status === "queued" || staged.status === "processing"

  return <div className="flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm hover:border-stone-200 hover:bg-stone-50">
    <span className="min-w-0 flex-1 truncate font-medium text-stone-800" title={staged.relativePath ? `${staged.relativePath}/${staged.filename}` : staged.filename}>
      {staged.relativePath && <span className="text-stone-400">{staged.relativePath}/</span>}{staged.filename}
    </span>
    <span className="shrink-0 text-xs text-stone-400">{formatSize(staged.sizeBytes)}</span>
    <StatusBadge staged={staged} />
    <div className="flex shrink-0 items-center gap-0.5 text-stone-500">
      {previewSrc && <button type="button" className="rounded p-1 hover:bg-stone-200 hover:text-stone-800" title="Preview" onClick={() => setPreview(true)}><Eye className="h-4 w-4" /></button>}
      {previewSrc && <a className="rounded p-1 hover:bg-stone-200 hover:text-stone-800" title="Download" href={previewSrc} download={staged.filename}><Download className="h-4 w-4" /></a>}
      {staged.status === "staged" && <button type="button" className="ml-1 rounded-md border border-stone-300 px-2 py-0.5 text-xs font-medium hover:bg-white disabled:opacity-50" disabled={busy} onClick={onExtract} title="Extract this file now"><span className="inline-flex items-center gap-1"><Play className="h-3 w-3" />Extract</span></button>}
      {onDiff && (staged.status === "done" || staged.status === "attention") && staged.documentId && <button type="button" className="rounded p-1 hover:bg-stone-200 hover:text-stone-800" title="Diff vs the last document of this shape" onClick={onDiff}><GitCompare className="h-4 w-4" /></button>}
      {(staged.status === "done" || staged.status === "attention" || staged.status === "failed" || staged.status === "duplicate") && staged.documentId && <button type="button" className="rounded p-1 hover:bg-stone-200 hover:text-stone-800 disabled:opacity-50" disabled={busy} title="Re-process" onClick={onReprocess}><RotateCw className="h-4 w-4" /></button>}
      <button type="button" className="rounded p-1 hover:bg-red-100 hover:text-red-600 disabled:opacity-50" disabled={working} title="Remove" onClick={onRemove}><Trash2 className="h-4 w-4" /></button>
    </div>

    {/* Portalled so the overlay escapes the panel's own fixed, overflow-hidden container
        instead of being clipped by (and stacked inside) this row. */}
    {preview && previewSrc && typeof document !== "undefined" && createPortal(<div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/50 p-6" onClick={() => setPreview(false)}>
      <div className="flex h-full max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="truncate text-sm font-semibold text-stone-800">{staged.filename}</span>
          <button type="button" className="rounded p-1 text-stone-500 hover:bg-stone-100" onClick={() => setPreview(false)}><X className="h-4 w-4" /></button>
        </div>
        <DocumentPreview className="flex-1" src={previewSrc} filename={staged.filename} mimeType={staged.mimeType} />
      </div>
    </div>, document.body)}
  </div>
}
