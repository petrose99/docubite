"use client"

import { DocumentPreview } from "@/components/documents/document-preview"
import type { StagedFile } from "@/components/extract/types"
import { AlertTriangle, Check, Copy, Download, Eye, GitCompare, Loader2, Play, RotateCw, Trash2, X } from "lucide-react"
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

function StatusBadge({ staged }: { staged: StagedFile }) {
  if (staged.status === "uploading") return <span className="inline-flex items-center gap-1 text-xs font-medium text-stone-500"><Loader2 className="h-3 w-3 animate-spin" />Uploading</span>
  if (staged.status === "queued" || staged.status === "processing") return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><Loader2 className="h-3 w-3 animate-spin" />Extracting</span>
  if (staged.status === "done") return <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><Check className="h-3 w-3" />Done</span>
  if (staged.status === "attention") return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600"><AlertTriangle className="h-3 w-3" />Review</span>
  if (staged.status === "failed") return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600" title={staged.error || undefined}><X className="h-3 w-3" />Failed</span>
  if (staged.status === "duplicate") return <span className="inline-flex items-center gap-1 text-xs font-medium text-stone-500" title="This exact file was already extracted"><Copy className="h-3 w-3" />Already extracted</span>
  return null
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
