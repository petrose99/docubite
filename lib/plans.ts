import config from "@/lib/config"

export type WorkspacePlan = {
  code: string
  name: string
  priceId: string
  /** Monthly price in whole currency units, for the Billing & Usage card. -1 means "talk to us". */
  price: number
  features: string[]
  /** -1 is unlimited. `members` is the one that gates team workspaces: at 1 seat, the Workspace
   * page shows the upgrade prompt instead of the members UI. */
  limits: { members: number; documents: number; ai: number }
}

/** Length of the free trial every new workspace starts on. Read by createWorkspaceForUser to
 * stamp WorkspaceSubscription.trialEndsAt, by the marketing pages, and by the Stripe checkout
 * route to carry the remaining days over as `trial_period_days`. */
export const TRIAL_DAYS = 14

export const WORKSPACE_PLANS: Record<string, WorkspacePlan> = {
  starter: {
    code: "starter",
    name: "Starter",
    priceId: config.stripe.starterPriceId,
    price: 29,
    features: ["1 user", "200 documents per month", "500 AI extractions per month", "Unlimited files and folders", "Link sharing"],
    limits: { members: 1, documents: 200, ai: 500 },
  },
  growth: {
    code: "growth",
    name: "Growth",
    priceId: config.stripe.growthPriceId,
    price: 99,
    features: ["Up to 10 users", "2,000 documents per month", "5,000 AI extractions per month", "Team workspaces", "Priority support"],
    limits: { members: 10, documents: 2_000, ai: 5_000 },
  },
  enterprise: {
    code: "enterprise",
    name: "Enterprise",
    priceId: "",
    price: -1,
    features: ["Unlimited users", "Unlimited documents", "Unlimited AI extractions", "Team workspaces", "Custom terms"],
    limits: { members: -1, documents: -1, ai: -1 },
  },
}

/** The master switch for plan *enforcement* (ENFORCE_PLAN_LIMITS). Everything that gates on a
 * limit — team-workspace creation, seat counts, invitations, document and AI quotas — reads its
 * numbers from getWorkspacePlan, so overriding them in one place here turns the whole upgrade
 * wall off without deleting the enforcement code. The plan's name, price and marketing
 * `features` are untouched: Billing & Usage still shows what the workspace is nominally on.
 *
 * Also read directly by consumeWorkspaceQuota, which gates trial expiry on it — that check has
 * no limit number to neutralise, so it needs the switch itself. */
export const PLAN_LIMITS_ENFORCED = config.billing.enforcePlanLimits

/** The limits an exempt workspace gets. Exported because models/workspaces.ts substitutes it for
 * the real plan's numbers when an admin owns the workspace. */
export const UNLIMITED_LIMITS: WorkspacePlan["limits"] = { members: -1, documents: -1, ai: -1 }

export function getWorkspacePlan(code: string) {
  const plan = WORKSPACE_PLANS[code] || WORKSPACE_PLANS.starter
  return PLAN_LIMITS_ENFORCED ? plan : { ...plan, limits: UNLIMITED_LIMITS }
}

export function isLimitReached(used: number, limit: number) {
  return limit >= 0 && used >= limit
}

export function canUseQuota(used: number, limit: number) {
  return !isLimitReached(used, limit)
}
