import { beforeEach, describe, expect, it, vi } from "vitest"

// Mocked at the module boundary — these tests never touch a database or a real provider. In
// particular quickbooks/xero/bigcapital's voidBill is mocked here rather than exercised for real:
// per the Phase C safety rule, a real (non-dry-run) voidBill/delete/push-retry is verified ONLY at
// this mocked level, never against a live server. See the Phase C report for the live-verification
// steps that were and weren't performed.
vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/lib/audit", () => ({ recordDocumentAudit: vi.fn() }))
vi.mock("@/lib/integration-token-refresh", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue("token-123"),
  TokenRefreshError: class TokenRefreshError extends Error {},
}))
vi.mock("@/lib/integrations/quickbooks/client", () => ({ voidBill: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/integrations/xero/client", () => ({ voidBill: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/integrations/bigcapital/client", () => ({ voidBill: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/integration-push", () => ({ attemptIntegrationPush: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/models/health", () => ({ resolveHealthFinding: vi.fn() }))

const { executeVoidDuplicate, executeRetryPush } = await import("@/lib/health/actions")
const { prisma } = await import("@/lib/db")
const { recordDocumentAudit } = await import("@/lib/audit")
const { resolveHealthFinding } = await import("@/models/health")
const quickbooks = await import("@/lib/integrations/quickbooks/client")
const bigcapital = await import("@/lib/integrations/bigcapital/client")
const { attemptIntegrationPush } = await import("@/lib/integration-push")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

const openVoidFinding = {
  id: "f1", status: "open", documentId: "d1", suggestedAction: "void_duplicate",
  suggestedActionPayload: { otherExternalTransactionId: "e2", kind: "bill" },
}

const ledgerTransaction = {
  id: "lt2", externalId: "e2", connectionId: "conn1", docNumber: "INV-2", amount: 100,
  currencyCode: "USD", contactName: "Acme", active: true,
}

const connection = { id: "conn1", provider: "bigcapital", externalTenantId: "org1", status: "active" }

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(db)) delete db[key]
  db.healthCheckResult = { findFirst: vi.fn().mockResolvedValue(openVoidFinding), update: vi.fn() }
  db.ledgerTransaction = { findFirst: vi.fn().mockResolvedValue(ledgerTransaction), update: vi.fn().mockResolvedValue(undefined) }
  db.integrationConnection = { findUnique: vi.fn().mockResolvedValue(connection) }
  db.integrationPush = { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn(), findUnique: vi.fn() }
})

describe("executeVoidDuplicate", () => {
  it("returns a preview and performs no write on dryRun", async () => {
    const result = await executeVoidDuplicate({ workspaceId: "ws1", findingId: "f1", actorId: "u1", dryRun: true })
    expect(result.ok).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(result.message).toMatch(/Dry run/)
    expect(quickbooks.voidBill).not.toHaveBeenCalled()
    expect(bigcapital.voidBill).not.toHaveBeenCalled()
    expect(resolveHealthFinding).not.toHaveBeenCalled()
    expect(recordDocumentAudit).not.toHaveBeenCalled()
  })

  it("calls the provider's voidBill and resolves the finding on a real execution", async () => {
    const result = await executeVoidDuplicate({ workspaceId: "ws1", findingId: "f1", actorId: "u1", dryRun: false })
    expect(result.ok).toBe(true)
    expect(bigcapital.voidBill).toHaveBeenCalledWith("token-123", "org1", "e2")
    expect(db.ledgerTransaction.update).toHaveBeenCalledWith({ where: { id: "lt2" }, data: { active: false } })
    expect(resolveHealthFinding).toHaveBeenCalledWith({ workspaceId: "ws1", findingId: "f1", actorId: "u1", action: "void_duplicate" })
    expect(recordDocumentAudit).toHaveBeenCalledWith(expect.objectContaining({ type: "health_remediation_void_duplicate", outcome: "success" }))
  })

  it("leaves the finding open and does not resolve it when the provider call fails", async () => {
    (bigcapital.voidBill as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("bigcapital_http_500"))
    const result = await executeVoidDuplicate({ workspaceId: "ws1", findingId: "f1", actorId: "u1", dryRun: false })
    expect(result.ok).toBe(false)
    expect(resolveHealthFinding).not.toHaveBeenCalled()
    expect(recordDocumentAudit).toHaveBeenCalledWith(expect.objectContaining({ type: "health_remediation_void_duplicate", outcome: "failure" }))
  })

  it("refuses a non-bill kind even if somehow set in the payload", async () => {
    db.healthCheckResult.findFirst.mockResolvedValue({ ...openVoidFinding, suggestedActionPayload: { otherExternalTransactionId: "e2", kind: "expense" } })
    const result = await executeVoidDuplicate({ workspaceId: "ws1", findingId: "f1", actorId: "u1", dryRun: false })
    expect(result.ok).toBe(false)
    expect(bigcapital.voidBill).not.toHaveBeenCalled()
  })

  it("refuses to act on a finding that is not open", async () => {
    db.healthCheckResult.findFirst.mockResolvedValue({ ...openVoidFinding, status: "resolved" })
    const result = await executeVoidDuplicate({ workspaceId: "ws1", findingId: "f1", actorId: "u1", dryRun: true })
    expect(result.ok).toBe(false)
  })

  it("refuses to act on a finding whose suggestedAction doesn't match", async () => {
    db.healthCheckResult.findFirst.mockResolvedValue({ ...openVoidFinding, suggestedAction: "retry_push" })
    const result = await executeVoidDuplicate({ workspaceId: "ws1", findingId: "f1", actorId: "u1", dryRun: true })
    expect(result.ok).toBe(false)
  })
})

describe("executeRetryPush", () => {
  const openRetryFinding = {
    id: "f2", status: "open", documentId: "d2", suggestedAction: "retry_push",
    suggestedActionPayload: { errorCode: "auth_expired", pushIds: ["p1", "p2"] },
  }

  it("returns a preview and performs no write on dryRun", async () => {
    db.healthCheckResult.findFirst.mockResolvedValue(openRetryFinding)
    db.integrationPush.findMany.mockResolvedValue([{ id: "p1", status: "failed", attempts: 5, documentId: "d2" }, { id: "p2", status: "failed", attempts: 5, documentId: "d2" }])
    const result = await executeRetryPush({ workspaceId: "ws1", findingId: "f2", actorId: "u1", dryRun: true })
    expect(result.ok).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(db.integrationPush.updateMany).not.toHaveBeenCalled()
    expect(attemptIntegrationPush).not.toHaveBeenCalled()
  })

  it("re-arms and retries each failed push, resolving the finding when all succeed", async () => {
    db.healthCheckResult.findFirst.mockResolvedValue(openRetryFinding)
    db.integrationPush.findMany.mockResolvedValue([{ id: "p1", status: "failed", attempts: 5, documentId: "d2" }])
    db.integrationPush.findUnique.mockResolvedValue({ status: "succeeded" })

    const result = await executeRetryPush({ workspaceId: "ws1", findingId: "f2", actorId: "u1", dryRun: false })

    expect(db.integrationPush.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] } },
      data: { status: "pending", attempts: 0, leaseUntil: null, nextAttemptAt: expect.any(Date), errorCode: null },
    })
    expect(attemptIntegrationPush).toHaveBeenCalledWith("p1")
    expect(result.ok).toBe(true)
    expect(resolveHealthFinding).toHaveBeenCalledWith({ workspaceId: "ws1", findingId: "f2", actorId: "u1", action: "retry_push" })
  })

  it("leaves the finding open when a push is still failing after the retry", async () => {
    db.healthCheckResult.findFirst.mockResolvedValue(openRetryFinding)
    db.integrationPush.findMany.mockResolvedValue([{ id: "p1", status: "failed", attempts: 5, documentId: "d2" }])
    db.integrationPush.findUnique.mockResolvedValue({ status: "failed" })

    const result = await executeRetryPush({ workspaceId: "ws1", findingId: "f2", actorId: "u1", dryRun: false })
    expect(result.ok).toBe(false)
    expect(resolveHealthFinding).not.toHaveBeenCalled()
  })
})
