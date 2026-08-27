import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/config", () => ({
  default: {
    isolation: { scopeGuard: "throw" },
    aws: { malwareScanUrl: "https://scan.example.com" },
    billing: { enforcePlanLimits: false },
    stripe: { secretKey: "", webhookSecret: "", starterPriceId: "", growthPriceId: "" },
  },
}))

const { verifyProductionConfig } = await import("@/lib/verify-production-config")
const config = (await import("@/lib/config")).default as {
  isolation: { scopeGuard: string }
  aws: { malwareScanUrl: string }
  billing: { enforcePlanLimits: boolean }
  stripe: { secretKey: string; webhookSecret: string; starterPriceId: string; growthPriceId: string }
}

const originalEnv = { ...process.env }

beforeEach(() => {
  config.isolation.scopeGuard = "throw"
  config.aws.malwareScanUrl = "https://scan.example.com"
  config.billing.enforcePlanLimits = false
  config.stripe = { secretKey: "", webhookSecret: "", starterPriceId: "", growthPriceId: "" }
  process.env = { ...originalEnv, NODE_ENV: "production", NEXT_PUBLIC_SENTRY_DSN: "https://sentry.example.com", ENFORCE_PLAN_LIMITS: "false" }
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe("verifyProductionConfig", () => {
  it("does nothing outside production", () => {
    process.env.NODE_ENV = "test"
    config.isolation.scopeGuard = "warn"
    expect(() => verifyProductionConfig()).not.toThrow()
  })

  it("passes in production when every hard requirement is met", () => {
    expect(() => verifyProductionConfig()).not.toThrow()
  })

  it("refuses to start when the scope guard is not in throw mode", () => {
    config.isolation.scopeGuard = "warn"
    expect(() => verifyProductionConfig()).toThrow(/DB_SCOPE_GUARD/)
  })

  it("refuses to start with no malware scan URL", () => {
    config.aws.malwareScanUrl = ""
    expect(() => verifyProductionConfig()).toThrow(/MALWARE_SCAN_URL/)
  })

  it("requires full Stripe configuration only when plan limits are enforced", () => {
    config.billing.enforcePlanLimits = true
    expect(() => verifyProductionConfig()).toThrow(/STRIPE/)

    config.stripe = { secretKey: "sk", webhookSecret: "whsec", starterPriceId: "price_1", growthPriceId: "price_2" }
    expect(() => verifyProductionConfig()).not.toThrow()
  })

  it("does not require Stripe when plan limits are not enforced", () => {
    config.billing.enforcePlanLimits = false
    config.stripe = { secretKey: "", webhookSecret: "", starterPriceId: "", growthPriceId: "" }
    expect(() => verifyProductionConfig()).not.toThrow()
  })

  it("warns instead of throwing when Sentry is unconfigured", () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(() => verifyProductionConfig()).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("NEXT_PUBLIC_SENTRY_DSN"))
    warn.mockRestore()
  })

  it("warns instead of throwing when ENFORCE_PLAN_LIMITS is not explicitly set", () => {
    delete process.env.ENFORCE_PLAN_LIMITS
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(() => verifyProductionConfig()).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ENFORCE_PLAN_LIMITS"))
    warn.mockRestore()
  })
})
