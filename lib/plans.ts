/** The app used to gate features behind pricing tiers and usage quotas. That system is gone —
 * everything is unlocked for every workspace — but getWorkspacePlan() stays as a stub so callers
 * that still ask "what can this workspace do" get a straight answer without every call site
 * needing to be rewritten in one pass. */
export type WorkspacePlan = {
  code: string
  name: string
  price: number
  features: string[]
  limits: { members: number; documents: number; ai: number }
  integrations: boolean
}

const UNLIMITED_PLAN: WorkspacePlan = {
  code: "unlimited",
  name: "Unlimited",
  price: 0,
  features: [],
  limits: { members: -1, documents: -1, ai: -1 },
  integrations: true,
}

export function getWorkspacePlan(_code?: string | null): WorkspacePlan {
  return UNLIMITED_PLAN
}
