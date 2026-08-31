"use client"

import { Minus, Plus, Maximize2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

export type ProvenanceTarget = { page: number; bbox: [number, number, number, number] | null; quote: string }

/** Above this many pages we stop rendering — a preview is for checking one value, not reading a
 * book, and a 400-page canvas column would lock the tab up. */
const MAX_RENDER_PAGES = 50

/** Renders a PDF into a scrolling column of canvases with a provenance highlight over the target
 * page, entirely on the client.
 *
 * pdf.js is heavy and browser-only, so it is imported lazily inside the effect — this component is
 * itself loaded through next/dynamic({ ssr: false }), so nothing here reaches the server render or
 * the sheet's own bundle until a source is actually previewed, exactly how Univer is isolated.
 *
 * The highlight is an absolutely-positioned div sized from the resolved bbox (already 0-1, top-left
 * origin) times the page's displayed size, so it lands on the printed value at any zoom. A null
 * bbox falls back to outlining the whole page — the value was matched to the page but not to a spot. */
export default function ProvenancePdf({ href, target }: { href: string; target?: ProvenanceTarget | null }) {
  const hostRef = useRef<HTMLDivElement>(null)
  // The loaded PDFDocumentProxy, kept across zoom changes so re-rendering never re-fetches.
  const pdfRef = useRef<{ numPages: number; getPage: (n: number) => Promise<unknown> } | null>(null)
  // Page 1's width at scale 1, used to compute a fit-to-width zoom.
  const baseWidthRef = useRef<number | null>(null)
  const [zoom, setZoom] = useState(1.2)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const pdfjs = await import("pdfjs-dist")
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()
        const response = await fetch(href)
        if (!response.ok) throw new Error("fetch_failed")
        const data = new Uint8Array(await response.arrayBuffer())
        if (cancelled) return
        pdfRef.current = await pdfjs.getDocument({ data }).promise as never
        if (!cancelled) setStatus("ready")
      } catch {
        if (!cancelled) setStatus("error")
      }
    })()
    return () => { cancelled = true }
  }, [href])

  // Renders (or re-renders on zoom) every page into the host, drawing the highlight on the target
  // page and scrolling it into view. Built imperatively so pdf.js owns its canvases outright.
  useEffect(() => {
    if (status !== "ready" || !pdfRef.current || !hostRef.current) return
    let cancelled = false
    const host = hostRef.current
    const dpr = window.devicePixelRatio || 1
    ;(async () => {
      const pdf = pdfRef.current!
      const pageCount = Math.min(pdf.numPages, MAX_RENDER_PAGES)
      host.replaceChildren()
      let targetWrapper: HTMLElement | null = null
      for (let pageNumber = 1; pageNumber <= pageCount && !cancelled; pageNumber++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const page = (await pdf.getPage(pageNumber)) as any
        if (cancelled) return
        if (pageNumber === 1) baseWidthRef.current = page.getViewport({ scale: 1 }).width
        const viewport = page.getViewport({ scale: zoom })
        const wrapper = document.createElement("div")
        wrapper.style.cssText = `position:relative;margin:0 auto 12px;width:${viewport.width}px;height:${viewport.height}px;box-shadow:0 1px 4px rgba(0,0,0,0.15);background:#fff`
        const canvas = document.createElement("canvas")
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.cssText = `width:${viewport.width}px;height:${viewport.height}px;display:block`
        const context = canvas.getContext("2d")
        if (!context) continue
        wrapper.appendChild(canvas)
        await page.render({ canvasContext: context, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise
        if (cancelled) return
        if (target && target.page === pageNumber) {
          const highlight = document.createElement("div")
          const base = "position:absolute;background:rgba(52,211,153,0.25);outline:2px solid rgb(16,185,129);border-radius:2px;pointer-events:none;animation:dbProvPulse 1.2s ease-out 1"
          if (target.bbox) {
            const [x0, y0, x1, y1] = target.bbox
            highlight.style.cssText = `${base};left:${x0 * viewport.width}px;top:${y0 * viewport.height}px;width:${(x1 - x0) * viewport.width}px;height:${(y1 - y0) * viewport.height}px`
          } else {
            highlight.style.cssText = `${base};inset:0`
          }
          wrapper.appendChild(highlight)
          targetWrapper = wrapper
        }
        host.appendChild(wrapper)
      }
      if (targetWrapper && !cancelled) targetWrapper.scrollIntoView({ block: "center", behavior: "auto" })
    })()
    return () => { cancelled = true }
  }, [status, zoom, target])

  const fitWidth = useCallback(() => {
    const host = hostRef.current
    if (!host || !baseWidthRef.current) return
    setZoom(Math.max(0.4, Math.min(3, (host.clientWidth - 32) / baseWidthRef.current)))
  }, [])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-slate-100">
      <style>{"@keyframes dbProvPulse{0%{background:rgba(52,211,153,0.55)}100%{background:rgba(52,211,153,0.25)}}"}</style>
      {status === "error" && <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Could not render this PDF. <a href={href} target="_blank" rel="noreferrer" className="ml-1 text-emerald-700 underline">Open it directly</a>.</div>}
      {status === "loading" && <div className="flex flex-1 items-center justify-center text-sm text-slate-400">Loading document…</div>}
      <div ref={hostRef} className={`min-h-0 flex-1 overflow-auto p-4 pb-16 ${status === "ready" ? "" : "hidden"}`} />
      {status === "ready" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-1.5 py-1 shadow-lg backdrop-blur">
            <button type="button" onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Zoom out"><Minus className="h-4 w-4" /></button>
            <span className="w-12 text-center text-xs tabular-nums text-slate-500">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((z) => Math.min(3, z + 0.2))} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Zoom in"><Plus className="h-4 w-4" /></button>
            <span className="mx-0.5 h-4 w-px bg-slate-200" />
            <button type="button" onClick={fitWidth} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Fit width"><Maximize2 className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  )
}
