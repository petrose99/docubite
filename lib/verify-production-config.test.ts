import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/config", () => ({
  default: {
    isolation: { scopeGuard: "throw" },
    aws: { malwareScanUrl: "https://scan.example.com" },
  },
}))

const { verifyProductionConfig } = await import("@/lib/verify-production-config")
const config = (await import("@/lib/config")).default as {
  isolation: { scopeGuard: string }
  aws: { malwareScanUrl: string }
}

const originalEnv = { ...process.env }

beforeEach(() => {
  config.isolation.scopeGuard = "throw"
  config.aws.malwareScanUrl = "https://scan.example.com"
  process.env = { ...originalEnv, NODE_ENV: "production", NEXT_PUBLIC_SENTRY_DSN: "https://sentry.example.com" }
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

  it("warns instead of throwing when Sentry is unconfigured", () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(() => verifyProductionConfig()).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("NEXT_PUBLIC_SENTRY_DSN"))
    warn.mockRestore()
  })
})
