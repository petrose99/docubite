import type { OnboardingStepKey } from "@/lib/section-copy"

export interface OnboardingState {
  dismissed: boolean
  tourSeen: boolean
  completedSteps: OnboardingStepKey[]
}

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  dismissed: false,
  tourSeen: false,
  completedSteps: [],
}

export function isOnboardingComplete(state: OnboardingState): boolean {
  return state.completedSteps.length >= 5
}

export function markStep(state: OnboardingState, step: OnboardingStepKey): OnboardingState {
  if (state.completedSteps.includes(step)) return state
  return { ...state, completedSteps: [...state.completedSteps, step] }
}

export function markTourSeen(state: OnboardingState): OnboardingState {
  return { ...state, tourSeen: true }
}

export function dismissOnboarding(state: OnboardingState): OnboardingState {
  return { ...state, dismissed: true }
}
