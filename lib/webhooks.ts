import { randomUUID } from "crypto"
import config from "@/lib/config"
import type { Document, Prisma } from "@/prisma/client"

/** The document export projection, inlined from documentDataForExport (models/documents.ts) rather
 * than imported. That function is trivial and pure, but its module transitively does a runtime
 * import of the Prisma client, which would pull the whole models/db chain into this otherwise-pure
 * module and take it out of the vitest resolver's reach (the client is a tsconfig-only path alias).
 * Keep this identical to the canonical version; it is two lines and changes ~never. */
function documentDataForExport(document: Pick<Document, "filename" | "status" | "receivedAt" | "reviewedData">) {
  return { filename: document.filename, status: document.status, received_at: document.receivedAt.toISOString(), ...((document.reviewedData as Record<string, unknown> | null) || {}) }
}

/** Outbound workspace event emission (P1). The catalog below is the contract receivers subscribe
 * to; adding an event is adding a member here and a call to emitWorkspaceEvent at its source.
 *
 * The delivery model, deliberately: one WebhookDelivery row per (event, subscribed endpoint). The
 * row carries a `payload` snapshot taken at emission and re-sent verbatim on every retry — a retry
 * is not a fresh render. Receivers that need current state follow the API link in the payload. All
 * deliveries for one event share an `eventId`, which is also the receiver's idempotency key. */

export const WEBHOOK_EVENT_TYPES = [
  "document.received",
  "document.ready_for_review",
  "document.needs_review",
  "document.reviewed",
  "document.failed",
  "document.deleted",
] as const

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number]

export function isWebhookEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value)
}

/** The document fields an event payload can carry. A `deleted` event has only id + filename (the
 * row is gone, there is nothing else to report); every other event carries the export projection. */
export type DocumentEventInput =
  | { id: string; filename: string; deleted: true }
  | (Pick<Document, "id" | "filename" | "status" | "receivedAt" | "reviewedData"> & {
      templateCode?: string | null
      confidence?: unknown
    })

export type WebhookEventPayload = {
  id: string
  type: WebhookEventType
  created_at: string
  workspace_id: string
  data: { document: Record<string, unknown> }
}

function documentLinks(workspaceId: string, documentId: string) {
  const base = config.app.baseURL.replace(/\/+$/, "")
  return {
    app: `${base}/workspaces/${workspaceId}/documents/${documentId}`,
    api: `${base}/api/v1/documents/${documentId}`,
  }
}

/** Builds one event payload. Pure: `eventId` and `createdAt` are passed in so the same event
 * produces byte-identical payloads across the fan-out and across retries, and so it is testable
 * without a clock. */
export function buildDocumentEventPayload(input: {
  eventId: string
  type: WebhookEventType
  workspaceId: string
  createdAt: Date
  document: DocumentEventInput
}): WebhookEventPayload {
  const { eventId, type, workspaceId, createdAt, document } = input
  const links = documentLinks(workspaceId, document.id)

  const data =
    "deleted" in document
      ? { id: document.id, filename: document.filename, links }
      : {
          id: document.id,
          links,
          template_code: document.templateCode ?? null,
          confidence: document.confidence ?? null,
          ...documentDataForExport(document),
        }

  return { id: eventId, type, created_at: createdAt.toISOString(), workspace_id: workspaceId, data: { document: data } }
}

/** True when an endpoint subscribes to `type`: empty `events` means "all events". Pure. */
export function endpointWantsEvent(endpointEvents: string[], type: WebhookEventType): boolean {
  return endpointEvents.length === 0 || endpointEvents.includes(type)
}

// --- /api/v1 document response shaping (pure) ---

type ApiDocument = Pick<Document, "id" | "workspaceId" | "filename" | "status" | "receivedAt" | "reviewedData" | "confidence"> & {
  template?: { code: string } | null
}

type ApiFieldValueRow = {
  fieldKey: string
  itemKey: string | null
  rowIndex: number | null
  valueText: string | null
  valueNumber: number | null
  valueDate: Date | null
  valueBool: boolean | null
  source: string
  sourceConfidence: number | null
  provenance: unknown
}

/** Collapses the four typed value columns into the one that is set. Order matters only in that at
 * most one is non-null per row; `??` (not `||`) so a legitimate 0 or false survives. */
export function fieldValueScalar(row: Pick<ApiFieldValueRow, "valueText" | "valueNumber" | "valueDate" | "valueBool">): string | number | boolean | null {
  if (row.valueText !== null) return row.valueText
  if (row.valueNumber !== null) return row.valueNumber
  if (row.valueDate !== null) return row.valueDate.toISOString()
  if (row.valueBool !== null) return row.valueBool
  return null
}

/** The GET /api/v1/documents/:id body: the same document shape a webhook carries, plus the typed
 * field_values with their confidence and provenance. Pure. */
export function buildApiDocumentResponse(input: { document: ApiDocument; fieldValues: ApiFieldValueRow[] }) {
  const { document, fieldValues } = input
  return {
    document: {
      id: document.id,
      links: documentLinks(document.workspaceId, document.id),
      template_code: document.template?.code ?? null,
      confidence: document.confidence ?? null,
      ...documentDataForExport(document),
    },
    field_values: fieldValues.map((f) => ({
      field_key: f.fieldKey,
      item_key: f.itemKey,
      row_index: f.rowIndex,
      value: fieldValueScalar(f),
      source: f.source,
      confidence: f.sourceConfidence,
      provenance: f.provenance ?? null,
    })),
  }
}

/** The GET /api/v1/documents list-item shape (lighter than the single-document body). Pure. */
export function buildApiDocumentListItem(document: ApiDocument) {
  return {
    id: document.id,
    links: documentLinks(document.workspaceId, document.id),
    template_code: document.template?.code ?? null,
    ...documentDataForExport(document),
  }
}

/** The transaction-client shape emitWorkspaceEvent needs. Narrowed to the two calls it makes so it
 * can be satisfied by a mock in tests as well as by a real Prisma.TransactionClient. */
export type EmitTxClient = {
  webhookEndpoint: {
    findMany(args: {
      where: { workspaceId: string; status: string }
      select: { id: true; events: true }
    }): Promise<Array<{ id: string; events: string[] }>>
  }
  webhookDelivery: {
    createMany(args: { data: Prisma.WebhookDeliveryCreateManyInput[] }): Promise<{ count: number }>
  }
}

/** Fans one event out to every active endpoint in the workspace that subscribes to it, inserting a
 * pending WebhookDelivery per endpoint inside the caller's transaction. Returns the shared eventId
 * and how many deliveries were queued (0 when nothing subscribes — the common case, and cheap).
 *
 * The caller kicks the delivery drain AFTER the transaction commits (the kickEmbedJob pattern), so
 * an event is never delivered for a document change that then rolls back. This function does no
 * network and starts no drain itself. */
export async function emitWorkspaceEvent(
  tx: EmitTxClient,
  input: { workspaceId: string; type: WebhookEventType; createdAt: Date; document: DocumentEventInput }
): Promise<{ eventId: string; queued: number }> {
  const eventId = randomUUID()
  const endpoints = await tx.webhookEndpoint.findMany({
    where: { workspaceId: input.workspaceId, status: "active" },
    select: { id: true, events: true },
  })
  const subscribed = endpoints.filter((e) => endpointWantsEvent(e.events, input.type))
  if (!subscribed.length) return { eventId, queued: 0 }

  const payload = buildDocumentEventPayload({ eventId, type: input.type, workspaceId: input.workspaceId, createdAt: input.createdAt, document: input.document })
  const documentId = "deleted" in input.document ? null : input.document.id

  await tx.webhookDelivery.createMany({
    data: subscribed.map((endpoint) => ({
      workspaceId: input.workspaceId,
      endpointId: endpoint.id,
      eventId,
      eventType: input.type,
      documentId,
      payload: payload as unknown as Prisma.InputJsonValue,
    })),
  })
  return { eventId, queued: subscribed.length }
}
