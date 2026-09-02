"use client"

import { markTourSeenAction } from "@/app/(app)/workspaces/[workspaceId]/onboarding-actions"
import { TOUR_STEPS } from "@/lib/section-copy"
import { useCallback, useEffect, useState } from "react"

export function WelcomeTour({ workspaceId, tourSeen }: { workspaceId: string; tourSeen: boolean }) {
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(false)
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!tourSeen) setVisible(true)
  }, [tourSeen])

  const measureTarget = useCallback((targetKey: string) => {
    const el = document.querySelector(`[data-tour-target="${targetKey}"]`)
    if (el) setSpotlightRect(el.getBoundingClientRect())
    else setSpotlightRect(null)
  }, [])

  useEffect(() => {
    if (!visible) return
    measureTarget(TOUR_STEPS[step].target)
    const handler = () => measureTarget(TOUR_STEPS[step].target)
    window.addEventListener("resize", handler)
    return () => window.removeEventListener("resize", handler)
  }, [visible, step, measureTarget])

  const close = useCallback(async () => {
    setVisible(false)
    await markTourSeenAction(workspaceId)
  }, [workspaceId])

  const next = useCallback(() => {
    if (step < TOUR_STEPS.length - 1) setStep(step + 1)
    else close()
  }, [step, close])

  useEffect(() => {
    if (!visible) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") close()
      else if (e.key === "ArrowRight" || e.key === "Enter") next()
      else if (e.key === "ArrowLeft" && step > 0) setStep(step - 1)
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [visible, step, close, next])

  if (!visible) return null

  const current = TOUR_STEPS[step]
  const pad = 6
  const sr = spotlightRect

  return <div className="fixed inset-0 z-[100]" role="dialog" aria-label="Welcome tour" aria-modal="true">
    <svg className="absolute inset-0 h-full w-full" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <mask id="tour-mask">
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          {sr && <rect x={sr.left - pad} y={sr.top - pad} width={sr.width + pad * 2} height={sr.height + pad * 2} rx="8" fill="black" />}
        </mask>
      </defs>
      <rect x="0" y="0" width="100%" height="100%" fill="rgba(15,23,42,0.45)" mask="url(#tour-mask)" />
    </svg>

    {sr && <div className="absolute z-[101] rounded-lg border border-[#e6ebf1] bg-white px-4 py-3 shadow-xl"
      style={{ top: sr.bottom + pad + 12, left: Math.max(12, sr.left), maxWidth: 280 }}>
      <p className="text-[14px] font-bold text-slate-900">{current.title}</p>
      <p className="mt-1 text-[13px] text-slate-600">{current.description}</p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[12px] text-slate-400">{step + 1} / {TOUR_STEPS.length}</span>
        <div className="flex gap-2">
          <button onClick={close} className="rounded px-2.5 py-1 text-[12.5px] font-medium text-slate-500 hover:text-slate-700">Skip</button>
          <button onClick={next} className="rounded-md bg-emerald-700 px-3 py-1 text-[12.5px] font-semibold text-white hover:bg-emerald-800">
            {step < TOUR_STEPS.length - 1 ? "Next" : "Done"}
          </button>
        </div>
      </div>
    </div>}
  </div>
}
