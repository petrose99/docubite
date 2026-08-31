"use client"

import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { useEffect } from "react"
import { createPortal } from "react-dom"

/** Confirmation for destructive actions. Portalled to the body so it is never clipped or
 * stacked by the panel/grid containers it is opened from. */
export function ConfirmDialog({ open, title, description, confirmLabel = "Confirm", destructive = false, busy = false, onConfirm, onCancel }: {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onCancel() }
    window.addEventListener("keydown", close)
    return () => window.removeEventListener("keydown", close)
  }, [open, busy, onCancel])

  // The dialog only ever opens after hydration, so there is nothing to mismatch on the server.
  if (!open || typeof document === "undefined") return null

  return createPortal(
    <div role="presentation" className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-6" onClick={() => { if (!busy) onCancel() }}>
      <div role="alertdialog" aria-modal="true" aria-label={title} className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="px-5 pb-4 pt-5">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-1.5 text-sm text-slate-500">{description}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t bg-slate-50 px-5 py-3">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button type="button" variant={destructive ? "destructive" : "default"} size="sm" autoFocus disabled={busy} onClick={onConfirm}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
