import { afterEach, describe, expect, it, vi } from "vitest"
import { getWorkspacePlan, isLimitReached, PLAN_LIMITS_ENFORCED, WORKSPACE_PLANS } from "./plans"

describe("plan limit enforcement", () => {
  it("is off unless ENFORCE_PLAN_LIMITS is set", () => {
    expect(PLAN_LIMITS_ENFORCED).toBe(process.env.ENFORCE_PLAN_LIMITS === "true")
  })

  it("reports every plan as unlimited while enforcement is off", () => {
    if (PLAN_LIMITS_ENFORCED) return
    for (const code of Object.keys(WORKSPACE_PLANS)) {
      expect(getWorkspacePlan(code).limits).toEqual({ members: -1, documents: -1, ai: -1 })
    }
    // Which is what actually opens the gates: seats, documents and AI all funnel through here.
    const starter = getWorkspacePlan("starter")
    expect(isLimitReached(50, starter.limits.members)).toBe(false)
    expect(isLimitReached(10_000, starter.limits.documents)).toBe(false)
  })

  it("leaves the plan's identity and marketing copy alone", () => {
    const starter = getWorkspacePlan("starter")
    expect(starter.code).toBe("starter")
    expect(starter.name).toBe("Starter")
    expect(starter.price).toBe(29)
    expect(starter.features).toEqual(WORKSPACE_PLANS.starter.features)
  })

  it("falls back to starter for an unknown plan code", () => {
    expect(getWorkspacePlan("nonsense").code).toBe("starter")
  })
})

/** The suite above runs against whatever the environment says, and vitest does not load .env, so
 * in practice that is "off". These re-import the module with the switch forced on — which is the
 * state that actually ships, and the only state in which the numbers below mean anything. */
describe("plan limits with enforcement on", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  const loadPlans = async () => {
    vi.stubEnv("ENFORCE_PLAN_LIMITS", "true")
    vi.resetModules()
    return import("./plans")
  }

  it("hands back the plan's real ceilings", async () => {
    const plans = await loadPlans()
    expect(plans.PLAN_LIMITS_ENFORCED).toBe(true)
    expect(plans.getWorkspacePlan("starter").limits).toEqual({ members: 1, documents: 200, ai: 500 })
    expect(plans.getWorkspacePlan("growth").limits).toEqual({ members: 10, documents: 2_000, ai: 5_000 })
  })

  it("still reports enterprise as unlimited", async () => {
    const plans = await loadPlans()
    expect(plans.getWorkspacePlan("enterprise").limits).toEqual({ members: -1, documents: -1, ai: -1 })
  })

  it("closes the gates the disabled switch was holding open", async () => {
    const plans = await loadPlans()
    const starter = plans.getWorkspacePlan("starter")
    expect(plans.isLimitReached(1, starter.limits.members)).toBe(true)
    expect(plans.isLimitReached(200, starter.limits.documents)).toBe(true)
    expect(plans.isLimitReached(199, starter.limits.documents)).toBe(false)
  })
})
