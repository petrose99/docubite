"use client"

import { SECTION_COPY, type SectionKey } from "@/lib/section-copy"
import { HelpCircle, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

export function SectionIntro({ section, workspaceId }: { section: SectionKey; workspaceId: string }) {
  const copy = SECTION_COPY[section]
  const storageKey = `section-intro-dismissed:${workspaceId}:${section}`
  const [dismissed, setDismissed] = useState(true)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(storageKey) === "1")
    } catch {
      setDismissed(false)
    }
  }, [storageKey])

  const dismiss = useCallback(() => {
    setDismissed(true)
    try { localStorage.setItem(storageKey, "1") } catch {}
  }, [storageKey])

  useEffect(() => {
    if (!popoverOpen) return
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setPopoverOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [popoverOpen])

  return <>
    {!dismissed && <div className="flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3.5 py-2.5 text-[13px] text-emerald-800">
      <span className="flex-1">{copy.banner}</span>
      <button onClick={dismiss} className="shrink-0 rounded p-0.5 text-emerald-600 hover:bg-emerald-100" aria-label="Dismiss">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>}

    <div className="relative inline-flex" ref={popoverRef}>
      <button
        onClick={() => setPopoverOpen(!popoverOpen)}
        className="rounded p-0.5 text-slate-400 hover:text-slate-600"
        aria-label="How it works"
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      {popoverOpen && <div className="absolute left-1/2 top-full z-50 mt-1.5 w-72 -translate-x-1/2 rounded-lg border border-[#e6ebf1] bg-white p-3.5 shadow-lg">
        <p className="mb-2 text-[13px] font-semibold text-slate-800">{copy.banner}</p>
        <ul className="space-y-1.5">
          {copy.howItWorks.map((step, i) => (
            <li key={i} className="flex gap-2 text-[12.5px] text-slate-600">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">{i + 1}</span>
              {step}
            </li>
          ))}
        </ul>
      </div>}
    </div>
  </>
}
