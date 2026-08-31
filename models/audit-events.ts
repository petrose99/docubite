import { prisma } from "@/lib/db"

/** Human-readable label for a DocumentAuditEvent.type value — the model stores only the raw
 * event string (see prisma/schema.prisma::DocumentAuditEvent), so this is the one place that
 * turns e.g. "document_field_edited" into "Field edited". Falls back to a title-cased version
 * of the raw type for anything not listed here, so a future write site never renders as blank. */
const EVENT_LABELS: Record<string, string> = {
  document_received: "Document received",
  document_reviewed: "Document reviewed",
  document_field_edited: "Field edited",
  document_deleted: "Document deleted",
  extraction_requeued: "Extraction re-queued",
  extraction_failed: "Extraction failed",
  extraction_retrying: "Extraction retrying",
  extraction_completed: "Extraction completed",
  embedding_completed: "Indexing completed",
  embedding_failed: "Indexing failed",
  document_searched: "Document search performed",
  field_suggestion_approved: "Suggested field approved",
  file_deleted: "File deleted",
  webhook_endpoint_disabled: "Webhook endpoint disabled",
  report_signed: "Report signed",
  transcript_edited: "Transcript edited",
  workspace_member_removed: "Member removed",
  workspace_member_left: "Member left",
}

export function auditEventLabel(type: string) {
  return EVENT_LABELS[type] ?? type.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())
}

/** The workspace's activity feed: every DocumentAuditEvent, newest first, with the actor's name
 * and the document's filename joined in so the UI never has to look either up separately. Actor
 * and document are both optional on the event itself (actor: SetNull on user delete, document:
 * Cascade on document delete leaves no orphaned row) — both render as a dash when absent. */
export async function listWorkspaceAuditEvents(workspaceId: string, limit = 100) {
  const events = await prisma.documentAuditEvent.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
    select: {
      id: true, type: true, createdAt: true,
      actor: { select: { name: true, email: true } },
      document: { select: { filename: true } },
    },
  })
  return events.map((event) => ({
    id: event.id,
    type: event.type,
    label: auditEventLabel(event.type),
    createdAt: event.createdAt,
    actorName: event.actor?.name || event.actor?.email || null,
    documentFilename: event.document?.filename ?? null,
  }))
}

/** One document's own history — the split-pane detail view's History tab. Same shape as
 * listWorkspaceAuditEvents, scoped to a single documentId instead of the whole workspace. */
export async function listDocumentAuditEvents(workspaceId: string, documentId: string, limit = 50) {
  const events = await prisma.documentAuditEvent.findMany({
    where: { workspaceId, documentId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
    select: { id: true, type: true, createdAt: true, actor: { select: { name: true, email: true } } },
  })
  return events.map((event) => ({
    id: event.id,
    type: event.type,
    label: auditEventLabel(event.type),
    createdAt: event.createdAt,
    actorName: event.actor?.name || event.actor?.email || null,
  }))
}
