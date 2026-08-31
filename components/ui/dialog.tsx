"use client"

import { X } from "lucide-react"
import { useEffect } from "react"
import { createPortal } from "react-dom"

/** The non-destructive counterpart to ConfirmDialog: a portalled modal that takes arbitrary
 * children, for the Create-folder and Share flows. Portalled to the body for the same reason —
 * so it is never clipped or stacked by the panel and grid containers it opens from. */
export function Dialog({ open, title, description, width = "max-w-md", onClose, children }: {
  open: boolean
  title: string
  description?: string
  width?: string
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    window.addEventListener("keydown", close)
    return () => window.removeEventListener("keydown", close)
  }, [open, onClose])

  if (!open || typeof document === "undefined") return null

  return createPortal(
    <div role="presentation" className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-6 pt-[10vh]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`w-full ${width} overflow-hidden rounded-xl bg-white shadow-2xl`} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
          </div>
          <button type="button" className="-mr-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
