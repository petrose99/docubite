import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/prisma/client", () => ({ Prisma: { JsonNull: null } }))
vi.mock("@/lib/integration-token-refresh", () => ({ getValidAccessToken: vi.fn().mockResolvedValue("token-1") }))
vi.mock("@/lib/integrations/quickbooks/client", () => ({
  listAccounts: vi.fn(),
  listVendors: vi.fn(),
  listTaxCodes: vi.fn(),
}))
vi.mock("@/lib/integrations/xero/client", () => ({
  listAccounts: vi.fn(),
  listContacts: vi.fn(),
  listTaxRates: vi.fn(),
}))

const { syncAccountingEntities } = await import("@/lib/integrations/sync")
const { prisma } = await import("@/lib/db")
const quickbooks = await import("@/lib/integrations/quickbooks/client")
const xero = await import("@/lib/integrations/xero/client")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(db)) delete db[key]
  db.accountingEntity = { upsert: vi.fn(), updateMany: vi.fn() }
  db.$transaction = vi.fn((ops: unknown[]) => Promise.all(ops))
})

describe("syncAccountingEntities", () => {
  it("throws when the connection has no external tenant id yet", async () => {
    db.integrationConnection = { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "c1", workspaceId: "w1", provider: "quickbooks", externalTenantId: null }) }
    await expect(syncAccountingEntities("c1")).rejects.toThrow("integration_connection_not_ready")
  })

  it("upserts every QuickBooks account, vendor, and tax code, and marks stale rows inactive", async () => {
    db.integrationConnection = { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "c1", workspaceId: "w1", provider: "quickbooks", externalTenantId: "realm1" }) }
    vi.mocked(quickbooks.listAccounts).mockResolvedValue([{ id: "a1", name: "Office supplies", active: true }])
    vi.mocked(quickbooks.listVendors).mockResolvedValue([{ id: "v1", name: "Acme", active: true }])
    vi.mocked(quickbooks.listTaxCodes).mockResolvedValue([{ id: "t1", name: "Standard", active: true }])

    await syncAccountingEntities("c1")

    expect(db.accountingEntity.upsert).toHaveBeenCalledTimes(3)
    expect(db.accountingEntity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { connectionId_entityType_externalId: { connectionId: "c1", entityType: "account", externalId: "a1" } },
    }))
    expect(db.accountingEntity.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ connectionId: "c1" }),
      data: { active: false },
    }))
  })

  it("upserts Xero accounts keyed by code, vendors keyed by id, and tax rates keyed by name", async () => {
    db.integrationConnection = { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "c2", workspaceId: "w1", provider: "xero", externalTenantId: "tenant1" }) }
    vi.mocked(xero.listAccounts).mockResolvedValue([{ code: "400", name: "Office supplies", active: true }])
    vi.mocked(xero.listContacts).mockResolvedValue([{ id: "contact1", name: "Acme", active: true }])
    vi.mocked(xero.listTaxRates).mockResolvedValue([{ name: "Standard rate", active: true }])

    await syncAccountingEntities("c2")

    expect(db.accountingEntity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { connectionId_entityType_externalId: { connectionId: "c2", entityType: "account", externalId: "400" } },
    }))
    expect(db.accountingEntity.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { connectionId_entityType_externalId: { connectionId: "c2", entityType: "tax_rate", externalId: "Standard rate" } },
    }))
  })
})
