"use client"

import { resetOnboardingAction } from "@/app/(app)/workspaces/[workspaceId]/onboarding-actions"
import { useTransition } from "react"

export function ResetTourButton({ workspaceId }: { workspaceId: string }) {
  const [pending, startTransition] = useTransition()

  return <button
    disabled={pending}
    onClick={() => startTransition(async () => {
      await resetOnboardingAction(workspaceId)
    })}
    className="text-sm font-medium text-emerald-700 underline-offset-2 hover:underline disabled:opacity-50"
  >
    {pending ? "Resetting..." : "Show welcome tour again"}
  </button>
}
