"use client"

import { Download, ExternalLink } from "lucide-react"

/** Renders a document's source inline: images directly, everything else (PDFs) in an iframe.
 *
 * Deliberately an <iframe> and not an <object>: where the browser has no built-in PDF viewer,
 * <object> falls back to *downloading* the file, which pops a save dialog over the app. The
 * iframe just renders empty there, so the footer below is the escape hatch — always visible,
 * because there is no reliable way to detect that the embedded viewer drew nothing. */
export function DocumentPreview({ src, filename, mimeType, className = "" }: {
  src: string
  filename: string
  mimeType: string
  className?: string
}) {
  if (mimeType.startsWith("image/")) {
    return <div className={`overflow-auto bg-stone-100 p-3 ${className}`}>
      <img src={src} alt={filename} className="mx-auto max-w-full" />
    </div>
  }

  return <div className={`flex min-h-0 flex-col ${className}`}>
    <iframe src={src} title={filename} className="w-full flex-1 bg-white" />
    <div className="flex items-center gap-2 border-t bg-stone-50 px-3 py-1.5 text-xs text-stone-500">
      <span className="min-w-0 flex-1 truncate">Preview not showing?</span>
      <a className="inline-flex shrink-0 items-center gap-1 font-medium text-stone-700 hover:text-stone-900 hover:underline" href={src} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" />Open in new tab</a>
      <a className="inline-flex shrink-0 items-center gap-1 font-medium text-stone-700 hover:text-stone-900 hover:underline" href={src} download={filename}><Download className="h-3 w-3" />Download</a>
    </div>
  </div>
}
