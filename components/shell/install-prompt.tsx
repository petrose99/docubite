"use client"

import { Download, X } from "lucide-react"
import { useEffect, useState } from "react"

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    try {
      if (localStorage.getItem("pwa-install-dismissed")) return
    } catch {}
    setDismissed(false)

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener("beforeinstallprompt", handler)
    return () => window.removeEventListener("beforeinstallprompt", handler)
  }, [])

  if (dismissed || !deferredPrompt) return null

  const install = async () => {
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === "accepted") setDeferredPrompt(null)
    setDismissed(true)
  }

  const dismiss = () => {
    setDismissed(true)
    try { localStorage.setItem("pwa-install-dismissed", "1") } catch {}
  }

  return <div className="fixed inset-x-0 bottom-0 z-50 p-3 md:hidden">
    <div className="flex items-center gap-3 rounded-2xl border border-[#e6ebf1] bg-white p-4 shadow-[0_4px_24px_rgba(15,23,42,0.12)]">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#065f46,#0f9d6f)] text-white">
        <Download className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-slate-900">Install DocuBite</div>
        <div className="text-[12.5px] text-slate-500">Add to home screen for quick access</div>
      </div>
      <button type="button" onClick={install}
        className="shrink-0 rounded-[10px] bg-[linear-gradient(180deg,#0b8f66,#047857)] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(4,120,87,0.4)]">
        Install
      </button>
      <button type="button" onClick={dismiss} className="shrink-0 p-1 text-slate-400 hover:text-slate-600" aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>
  </div>
}
