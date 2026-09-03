"use client"

import { dismissOnboardingAction, markOnboardingStepAction } from "@/app/(app)/workspaces/[workspaceId]/onboarding-actions"
import type { OnboardingState } from "@/lib/onboarding"
import { isOnboardingComplete } from "@/lib/onboarding"
import { ONBOARDING_STEPS, type OnboardingStepKey } from "@/lib/section-copy"
import { CheckCircle2, Circle, Rocket, X } from "lucide-react"
import { useCallback, useState, useTransition } from "react"

export function GettingStartedCard({ workspaceId, initialState, liveCounts }: {
  workspaceId: string
  initialState: OnboardingState
  liveCounts: { uploaded: number; reviewed: number; placedInSheet: number }
}) {
  const [state, setState] = useState(initialState)
  const [, startTransition] = useTransition()

  const autoCompleted = useCallback((): OnboardingStepKey[] => {
    const auto: OnboardingStepKey[] = []
    if (liveCounts.uploaded > 0) auto.push("upload")
    if (liveCounts.reviewed > 0) auto.push("review")
    return auto
  }, [liveCounts])

  const isStepDone = useCallback((key: OnboardingStepKey) => {
    return state.completedSteps.includes(key) || autoCompleted().includes(key)
  }, [state.completedSteps, autoCompleted])

  const allDone = isOnboardingComplete(state) || ONBOARDING_STEPS.every((s) => isStepDone(s.key))
  if (state.dismissed || allDone) return null

  const dismiss = () => {
    setState({ ...state, dismissed: true })
    startTransition(() => { dismissOnboardingAction(workspaceId) })
  }

  const completeStep = (step: OnboardingStepKey) => {
    if (isStepDone(step)) return
    const next = { ...state, completedSteps: [...state.completedSteps, step] }
    setState(next)
    startTransition(() => { markOnboardingStepAction(workspaceId, step) })
  }

  const doneCount = ONBOARDING_STEPS.filter((s) => isStepDone(s.key)).length
  const progress = Math.round((doneCount / ONBOARDING_STEPS.length) * 100)

  return <div className="rounded-2xl border border-[#e6ebf1] bg-white p-5 shadow-panel">
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><Rocket className="h-[17px] w-[17px]" /></span>
        <h2 className="text-[15px] font-bold text-slate-900">Getting started</h2>
      </div>
      <button onClick={dismiss} className="rounded p-1 text-slate-400 hover:text-slate-600" aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>

    <div className="mt-3 h-1.5 rounded-full bg-slate-100">
      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
    </div>
    <p className="mt-1.5 text-[12px] text-slate-400">{doneCount} of {ONBOARDING_STEPS.length} complete</p>

    <ul className="mt-3 space-y-1.5">
      {ONBOARDING_STEPS.map((step) => {
        const done = isStepDone(step.key)
        return <li key={step.key} className="flex items-center gap-2">
          <button
            onClick={() => completeStep(step.key)}
            disabled={done}
            className="shrink-0"
            aria-label={done ? `${step.label} (complete)` : `Mark ${step.label} as complete`}
          >
            {done
              ? <CheckCircle2 className="h-[18px] w-[18px] text-emerald-600" />
              : <Circle className="h-[18px] w-[18px] text-slate-300" />
            }
          </button>
          <span className={`text-[13px] ${done ? "text-slate-400 line-through" : "text-slate-700"}`}>{step.label}</span>
        </li>
      })}
    </ul>
  </div>
}
