"use client"

import { Download, ExternalLink, X } from "lucide-react"
import dynamic from "next/dynamic"
import { useEffect } from "react"
import type { ProvenanceTarget } from "./provenance-pdf"

export type SourceDocument = { documentId: string; filename: string; mimeType?: string }
export type { ProvenanceTarget }

/** pdf.js and the canvas rendering it drives are browser-only and weigh far more than the rest of
 * the sheet; loaded through next/dynamic({ ssr: false }) so none of it reaches the server render or
 * the main bundle until a PDF is actually previewed. */
const ProvenancePdf = dynamic(() => import("./provenance-pdf"), { ssr: false, loading: () => <div className="flex flex-1 items-center justify-center bg-slate-100 text-sm text-slate-400">Loading viewer…</div> })

/** The document a row came from, floating over the grid, optionally scrolled and highlighted to
 * the exact spot a value was read from.
 *
 * A spreadsheet of extracted fields is a claim about a source nobody is looking at; opening the
 * source at the value turns reviewing the sheet into checking the work rather than trusting it.
 * With a `target`, a PDF renders through pdf.js with the value highlighted, and an image gets the
 * same overlay; without one (a cell the user typed, a document with no provenance), the file just
 * opens. Non-PDF, non-image types fall back to the browser's own inline viewer. */
/** The viewer body — pdf.js / highlighted image / plain iframe fallback — with no modal chrome
 * around it. Extracted so the pipeline's split-pane document detail (Phase 3) can embed it inline
 * beside the review form, while the full-screen SourcePreview below reuses it unchanged for every
 * caller that still wants the overlay (the sheet, folder report, run-diff dialog). */
export function SourceViewer({ source, target }: { source: SourceDocument; target?: ProvenanceTarget | null }) {
  const href = `/api/documents/${source.documentId}/source`
  const isPdf = source.mimeType === "application/pdf" || (!source.mimeType && source.filename.toLowerCase().endsWith(".pdf"))
  const isImage = source.mimeType?.startsWith("image/")
  const positionUnavailable = !!target && !target.bbox

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {target && (target.quote || positionUnavailable) && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-emerald-50 px-3 py-1.5 text-xs text-emerald-900">
          {target.quote && <span className="rounded bg-white/70 px-1.5 py-0.5 font-medium">“{target.quote}”</span>}
          <span className="text-emerald-700">page {target.page}</span>
          {positionUnavailable && <span className="ml-auto rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-800">Matched on page {target.page} — exact position unavailable</span>}
        </div>
      )}
      {isPdf ? (
        <ProvenancePdf href={href} target={target} />
      ) : isImage ? (
        <ProvenanceImage href={href} filename={source.filename} target={target} />
      ) : (
        <iframe src={href} title={source.filename} className="min-h-0 flex-1 bg-slate-100" />
      )}
    </div>
  )
}

/** Full-screen modal wrapper around SourceViewer — a document floating over the grid, with an
 * open-in-new-tab / download / close header. See SourceViewer's own doc-comment for why the two
 * are split. */
export function SourcePreview({ source, target, onClose }: { source: SourceDocument; target?: ProvenanceTarget | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const href = `/api/documents/${source.documentId}/source`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-6" onClick={onClose}>
      <div className="flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <span className="truncate text-sm font-semibold text-slate-800" title={source.filename}>{source.filename}</span>
          <a href={href} target="_blank" rel="noreferrer" className="ml-auto rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Open in a new tab">
            <ExternalLink className="h-4 w-4" />
          </a>
          <a href={href} download={source.filename} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Download">
            <Download className="h-4 w-4" />
          </a>
          <button type="button" aria-label="Close preview" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <SourceViewer source={source} target={target} />
      </div>
    </div>
  )
}

/** An image source with the same highlight overlay as the PDF viewer. The bbox is 0-1, so it maps
 * onto the displayed image with plain percentages regardless of the image's natural size. */
function ProvenanceImage({ href, filename, target }: { href: string; filename: string; target?: ProvenanceTarget | null }) {
  const box = target?.bbox
  return (
    <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-slate-100 p-4">
      <div className="relative inline-block">
        <style>{"@keyframes dbProvPulse{0%{background:rgba(52,211,153,0.55)}100%{background:rgba(52,211,153,0.25)}}"}</style>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={href} alt={filename} className="block max-w-full" />
        {target && (
          <div
            className="pointer-events-none absolute rounded-sm"
            style={box
              ? { left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%`, background: "rgba(52,211,153,0.25)", outline: "2px solid rgb(16,185,129)", animation: "dbProvPulse 1.2s ease-out 1" }
              : { inset: 0, outline: "2px solid rgb(16,185,129)", animation: "dbProvPulse 1.2s ease-out 1" }} />
        )}
      </div>
    </div>
  )
}
