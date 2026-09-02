"use server"

import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/db"
import type { OnboardingState } from "@/lib/onboarding"
import { DEFAULT_ONBOARDING_STATE, markStep, markTourSeen, dismissOnboarding as dismissState } from "@/lib/onboarding"
import type { OnboardingStepKey } from "@/lib/section-copy"
import type { Prisma } from "@/prisma/client"
import { randomUUID } from "crypto"

async function readState(userId: string, workspaceId: string): Promise<OnboardingState> {
  const row = await prisma.userListPreference.findUnique({
    where: { userId_workspaceId_viewKey: { userId, workspaceId, viewKey: "onboarding" } },
  })
  if (!row) return DEFAULT_ONBOARDING_STATE
  return row.filters as unknown as OnboardingState
}

async function writeState(userId: string, workspaceId: string, state: OnboardingState) {
  await prisma.userListPreference.upsert({
    where: { userId_workspaceId_viewKey: { userId, workspaceId, viewKey: "onboarding" } },
    create: {
      id: randomUUID(),
      userId,
      workspaceId,
      viewKey: "onboarding",
      columns: [] as Prisma.InputJsonValue,
      filters: state as unknown as Prisma.InputJsonValue,
      sort: {} as Prisma.InputJsonValue,
    },
    update: { filters: state as unknown as Prisma.InputJsonValue },
  })
}

export async function getOnboardingStateAction(workspaceId: string): Promise<OnboardingState> {
  const user = await getCurrentUser()
  return readState(user.id, workspaceId)
}

export async function markOnboardingStepAction(workspaceId: string, step: OnboardingStepKey): Promise<OnboardingState> {
  const user = await getCurrentUser()
  const current = await readState(user.id, workspaceId)
  const next = markStep(current, step)
  if (next !== current) await writeState(user.id, workspaceId, next)
  return next
}

export async function markTourSeenAction(workspaceId: string): Promise<OnboardingState> {
  const user = await getCurrentUser()
  const current = await readState(user.id, workspaceId)
  const next = markTourSeen(current)
  if (next !== current) await writeState(user.id, workspaceId, next)
  return next
}

export async function dismissOnboardingAction(workspaceId: string): Promise<OnboardingState> {
  const user = await getCurrentUser()
  const current = await readState(user.id, workspaceId)
  const next = dismissState(current)
  if (next !== current) await writeState(user.id, workspaceId, next)
  return next
}

export async function resetOnboardingAction(workspaceId: string): Promise<OnboardingState> {
  const user = await getCurrentUser()
  await writeState(user.id, workspaceId, DEFAULT_ONBOARDING_STATE)
  return DEFAULT_ONBOARDING_STATE
}
