import { describe, expect, it, vi } from "vitest"
import {
  buildApiDocumentResponse,
  buildDocumentEventPayload,
  emitWorkspaceEvent,
  endpointWantsEvent,
  fieldValueScalar,
  isWebhookEventType,
  WEBHOOK_EVENT_TYPES,
} from "./webhooks"

const createdAt = new Date("2026-08-26T10:00:00.000Z")
const workspaceId = "11111111-1111-1111-1111-111111111111"

describe("event catalog", () => {
  it("recognises catalog members and rejects others", () => {
    expect(isWebhookEventType("document.reviewed")).toBe(true)
    expect(isWebhookEventType("document.exploded")).toBe(false)
    expect(WEBHOOK_EVENT_TYPES).toContain("document.received")
  })
})

describe("endpointWantsEvent", () => {
  it("empty subscription means all events", () => {
    expect(endpointWantsEvent([], "document.failed")).toBe(true)
  })
  it("otherwise matches only listed events", () => {
    expect(endpointWantsEvent(["document.reviewed"], "document.reviewed")).toBe(true)
    expect(endpointWantsEvent(["document.reviewed"], "document.failed")).toBe(false)
  })
})

describe("buildDocumentEventPayload", () => {
  it("builds a full document payload with links and export fields", () => {
    const payload = buildDocumentEventPayload({
      eventId: "evt_1",
      type: "document.reviewed",
      workspaceId,
      createdAt,
      document: {
        id: "doc_9",
        filename: "invoice.pdf",
        status: "reviewed",
        receivedAt: new Date("2026-08-20T00:00:00.000Z"),
        reviewedData: { total: 42, vendor: "Acme" },
        templateCode: "invoice",
        confidence: { total: 0.98 },
      },
    })
    expect(payload).toMatchObject({
      id: "evt_1",
      type: "document.reviewed",
      created_at: "2026-08-26T10:00:00.000Z",
      workspace_id: workspaceId,
    })
    const doc = payload.data.document
    expect(doc.id).toBe("doc_9")
    expect(doc.template_code).toBe("invoice")
    expect(doc.total).toBe(42) // spread from documentDataForExport
    expect(doc.received_at).toBe("2026-08-20T00:00:00.000Z")
    expect(doc.links).toEqual({
      app: `http://localhost:7331/workspaces/${workspaceId}/documents/doc_9`,
      api: `http://localhost:7331/api/v1/documents/doc_9`,
    })
  })

  it("builds a minimal deleted payload (id + filename only)", () => {
    const payload = buildDocumentEventPayload({
      eventId: "evt_2",
      type: "document.deleted",
      workspaceId,
      createdAt,
      document: { id: "doc_x", filename: "gone.pdf", deleted: true },
    })
    expect(payload.data.document).toEqual({
      id: "doc_x",
      filename: "gone.pdf",
      links: {
        app: `http://localhost:7331/workspaces/${workspaceId}/documents/doc_x`,
        api: `http://localhost:7331/api/v1/documents/doc_x`,
      },
    })
    expect(payload.data.document).not.toHaveProperty("status")
  })
})

describe("fieldValueScalar", () => {
  const base = { valueText: null, valueNumber: null, valueDate: null, valueBool: null }
  it("returns the one set column, preserving 0 and false", () => {
    expect(fieldValueScalar({ ...base, valueText: "Acme" })).toBe("Acme")
    expect(fieldValueScalar({ ...base, valueNumber: 0 })).toBe(0)
    expect(fieldValueScalar({ ...base, valueBool: false })).toBe(false)
    expect(fieldValueScalar({ ...base, valueDate: new Date("2026-01-02T00:00:00Z") })).toBe("2026-01-02T00:00:00.000Z")
    expect(fieldValueScalar(base)).toBeNull()
  })
})

describe("buildApiDocumentResponse", () => {
  it("shapes the document plus typed field_values", () => {
    const res = buildApiDocumentResponse({
      document: {
        id: "doc_1",
        workspaceId,
        filename: "invoice.pdf",
        status: "reviewed",
        receivedAt: new Date("2026-08-20T00:00:00.000Z"),
        reviewedData: { total: 42 },
        confidence: { total: 0.9 },
        template: { code: "invoice" },
      },
      fieldValues: [
        { fieldKey: "total", itemKey: null, rowIndex: null, valueText: null, valueNumber: 42, valueDate: null, valueBool: null, source: "llm_structured", sourceConfidence: 0.9, provenance: { page: 1 } },
      ],
    })
    expect(res.document.template_code).toBe("invoice")
    expect(res.document.links.api).toContain("/api/v1/documents/doc_1")
    expect(res.field_values).toEqual([
      { field_key: "total", item_key: null, row_index: null, value: 42, source: "llm_structured", confidence: 0.9, provenance: { page: 1 } },
    ])
  })
})

describe("emitWorkspaceEvent", () => {
  function mockTx(endpoints: Array<{ id: string; events: string[] }>) {
    return {
      webhookEndpoint: { findMany: vi.fn().mockResolvedValue(endpoints) },
      webhookDelivery: { createMany: vi.fn().mockResolvedValue({ count: endpoints.length }) },
    }
  }
  const doc = {
    id: "doc_1",
    filename: "a.pdf",
    status: "reviewed",
    receivedAt: createdAt,
    reviewedData: {},
  }

  it("queues nothing when no endpoint subscribes", async () => {
    const tx = mockTx([{ id: "e1", events: ["document.failed"] }])
    const res = await emitWorkspaceEvent(tx, { workspaceId, type: "document.reviewed", createdAt, document: doc })
    expect(res.queued).toBe(0)
    expect(tx.webhookDelivery.createMany).not.toHaveBeenCalled()
  })

  it("inserts one delivery per subscribed endpoint sharing an eventId", async () => {
    const tx = mockTx([
      { id: "e1", events: [] }, // all events
      { id: "e2", events: ["document.reviewed"] }, // this one
      { id: "e3", events: ["document.failed"] }, // not this one
    ])
    const res = await emitWorkspaceEvent(tx, { workspaceId, type: "document.reviewed", createdAt, document: doc })
    expect(res.queued).toBe(2)
    const rows = tx.webhookDelivery.createMany.mock.calls[0][0].data
    expect(rows).toHaveLength(2)
    expect(rows.map((r: { endpointId: string }) => r.endpointId).sort()).toEqual(["e1", "e2"])
    expect(new Set(rows.map((r: { eventId: string }) => r.eventId)).size).toBe(1)
    expect(rows[0].eventId).toBe(res.eventId)
    expect(rows[0].documentId).toBe("doc_1")
  })

  it("nulls documentId on a deleted event (the row is being removed)", async () => {
    const tx = mockTx([{ id: "e1", events: [] }])
    await emitWorkspaceEvent(tx, {
      workspaceId,
      type: "document.deleted",
      createdAt,
      document: { id: "doc_1", filename: "a.pdf", deleted: true },
    })
    const rows = tx.webhookDelivery.createMany.mock.calls[0][0].data
    expect(rows[0].documentId).toBeNull()
  })
})
