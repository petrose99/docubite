import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/prisma/client", () => ({ Prisma: {}, PrismaClient: vi.fn() }))

const { auditEventLabel } = await import("@/models/audit-events")

describe("auditEventLabel", () => {
  it("labels known event types", () => {
    expect(auditEventLabel("document_field_edited")).toBe("Field edited")
    expect(auditEventLabel("webhook_endpoint_disabled")).toBe("Webhook endpoint disabled")
  })

  it("falls back to a title-cased version of unknown types", () => {
    expect(auditEventLabel("some_future_event")).toBe("Some future event")
  })
})
