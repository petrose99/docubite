import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// DB + crypto are stubbed so the orchestrator's control flow is testable without a database, a real
// key, or a network. The pure verdict logic it delegates to lives in webhook-delivery-policy (tested
// there); these tests cover the wiring: claim race, success reset, failure backoff, disabled skip.
vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/prisma/client", () => ({ Prisma: {}, PrismaClient: vi.fn() }))
vi.mock("@/lib/secret-crypto", () => ({ decryptSecret: () => "whsec_test" }))

const { claimNextWebhookDelivery, deliverWebhook } = await import("./webhook-delivery")
const db = (await import("@/lib/db")) as unknown as { prisma: Record<string, any> }

const now = new Date("2026-08-26T12:00:00.000Z")
// A literal public IP so assertUrlSafe classifies it without a DNS lookup.
const ENDPOINT_URL = "https://93.184.216.34/hook"

function makePrisma(overrides: Record<string, any> = {}) {
  const tx = {
    webhookDelivery: { update: vi.fn().mockResolvedValue({}) },
    webhookEndpoint: { update: vi.fn().mockResolvedValue({}) },
    documentAuditEvent: { create: vi.fn().mockResolvedValue({}) },
  }
  return {
    _tx: tx,
    webhookDelivery: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      ...(overrides.webhookDelivery ?? {}),
    },
    webhookEndpoint: { update: vi.fn().mockResolvedValue({}) },
    documentAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  }
}

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { vi.unstubAllGlobals() })

describe("claimNextWebhookDelivery", () => {
  it("returns the id when the atomic claim wins", async () => {
    db.prisma = makePrisma({
      webhookDelivery: {
        findFirst: vi.fn().mockResolvedValue({ id: "d1" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    })
    expect(await claimNextWebhookDelivery(now)).toBe("d1")
  })

  it("returns null when nothing is due", async () => {
    db.prisma = makePrisma({ webhookDelivery: { findFirst: vi.fn().mockResolvedValue(null) } })
    expect(await claimNextWebhookDelivery(now)).toBeNull()
  })

  it("returns null when another drain won the race (claim updated 0 rows)", async () => {
    db.prisma = makePrisma({
      webhookDelivery: {
        findFirst: vi.fn().mockResolvedValue({ id: "d1" }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    })
    expect(await claimNextWebhookDelivery(now)).toBeNull()
  })
})

describe("deliverWebhook", () => {
  const baseDelivery = {
    id: "d1", workspaceId: "w1", status: "pending", attempts: 0, eventId: "e1", eventType: "document.reviewed",
    payload: { id: "e1", type: "document.reviewed" },
    endpoint: { id: "ep1", url: ENDPOINT_URL, secretEnc: "v1.x.y.z", status: "active", failureCount: 0 },
  }

  it("marks delivered and signs the request on a 2xx", async () => {
    const prisma = makePrisma()
    prisma.webhookDelivery.findUnique = vi.fn().mockResolvedValue(baseDelivery)
    db.prisma = prisma
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, body: null })
    vi.stubGlobal("fetch", fetchMock)

    await deliverWebhook("d1", now)

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(ENDPOINT_URL)
    expect(init.redirect).toBe("manual")
    expect(init.headers["x-docubite-signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/)
    expect(init.headers["x-docubite-event"]).toBe("document.reviewed")
    const deliveryUpdate = prisma._tx.webhookDelivery.update.mock.calls[0][0].data
    expect(deliveryUpdate.status).toBe("delivered")
    expect(prisma._tx.webhookEndpoint.update.mock.calls[0][0].data).toEqual({ failureCount: 0 })
  })

  it("schedules a retry on a 500 and bumps the endpoint failure count", async () => {
    const prisma = makePrisma()
    prisma.webhookDelivery.findUnique = vi.fn().mockResolvedValue({ ...baseDelivery, attempts: 2, endpoint: { ...baseDelivery.endpoint, failureCount: 4 } })
    db.prisma = prisma
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500, body: null }))

    await deliverWebhook("d1", now)

    const deliveryUpdate = prisma._tx.webhookDelivery.update.mock.calls[0][0].data
    expect(deliveryUpdate.status).toBe("pending")
    expect(deliveryUpdate.nextAttemptAt).toEqual(new Date(now.getTime() + 8 * 60_000))
    expect(prisma._tx.webhookEndpoint.update.mock.calls[0][0].data).toEqual({ failureCount: 5 })
  })

  it("records a transport failure without a response status", async () => {
    const prisma = makePrisma()
    prisma.webhookDelivery.findUnique = vi.fn().mockResolvedValue(baseDelivery)
    db.prisma = prisma
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("timed out"), { name: "TimeoutError" })))

    await deliverWebhook("d1", now)

    const deliveryUpdate = prisma._tx.webhookDelivery.update.mock.calls[0][0].data
    expect(deliveryUpdate.responseStatus).toBeNull()
    expect(deliveryUpdate.errorCode).toBe("delivery_timeout")
  })

  it("fails a delivery to a now-disabled endpoint without posting", async () => {
    const prisma = makePrisma()
    prisma.webhookDelivery.findUnique = vi.fn().mockResolvedValue({ ...baseDelivery, endpoint: { ...baseDelivery.endpoint, status: "disabled" } })
    db.prisma = prisma
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await deliverWebhook("d1", now)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(prisma.webhookDelivery.update.mock.calls[0][0].data).toMatchObject({ status: "failed", errorCode: "endpoint_disabled" })
  })

  it("skips a delivery that is no longer pending", async () => {
    const prisma = makePrisma()
    prisma.webhookDelivery.findUnique = vi.fn().mockResolvedValue({ ...baseDelivery, status: "delivered" })
    db.prisma = prisma
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await deliverWebhook("d1", now)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
