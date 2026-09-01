import { prisma } from "@/lib/db"
import { Prisma } from "@/prisma/client"

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
  workspace_member_role_changed: "Member role changed",
  workspace_ownership_transferred: "Ownership transferred",
  workspace_created: "Workspace created",
  workspace_renamed: "Workspace renamed",
  workspace_deleted: "Workspace deleted",
  invitation_created: "Invitation sent",
  invitation_revoked: "Invitation revoked",
  invitation_accepted: "Invitation accepted",
  api_key_created: "API key created",
  api_key_revoked: "API key revoked",
  webhook_endpoint_created: "Webhook endpoint created",
  webhook_endpoint_enabled: "Webhook endpoint enabled",
  webhook_endpoint_deleted: "Webhook endpoint deleted",
  integration_disconnected: "Integration disconnected",
  integration_default_account_changed: "Default expense account changed",
  auth_signup: "Account created",
  auth_password_reset_requested: "Password reset requested",
  auth_login_success: "Signed in",
  auth_login_failed: "Sign-in failed",
  auth_logout: "Signed out",
  auth_mfa_enrolled: "MFA enrolled",
  auth_mfa_unenrolled: "MFA unenrolled",
  auth_password_changed: "Password changed",
  integration_push_succeeded: "Bill pushed to accounting",
  integration_push_failed: "Accounting push failed",
  integration_push_enqueued: "Push to accounting queued",
  integration_batch_push: "Batch push to accounting",
  integration_entities_synced: "Accounting entities synced",
  bigcapital_provisioned: "Bigcapital account provisioned",
  bigcapital_provision_failed: "Bigcapital provisioning failed",
  bigcapital_provision_enqueued: "Bigcapital provisioning started",
  activity_exported: "Activity log exported",
}

export function auditEventLabel(type: string) {
  return EVENT_LABELS[type] ?? type.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase())
}

export type AuditEventFilters = {
  type?: string
  actorId?: string
  from?: Date
  to?: Date
}

/** Shared by listWorkspaceAuditEvents and its CSV-export counterpart (the activity page's Export
 * button) so the two can never drift on what "matching the filters" means. `to` is treated as
 * inclusive of the whole day the caller passed, since the UI only offers a date, not a time. */
function auditEventWhere(workspaceId: string, filters: AuditEventFilters = {}): Prisma.DocumentAuditEventWhereInput {
  return {
    workspaceId,
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.from || filters.to
      ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
  }
}

/** The workspace's activity feed: every DocumentAuditEvent, newest first, with the actor's name
 * and the document's filename joined in so the UI never has to look either up separately. Actor
 * and document are both optional on the event itself (actor: SetNull on user delete, document:
 * Cascade on document delete leaves no orphaned row) — both render as a dash when absent. */
export async function listWorkspaceAuditEvents(workspaceId: string, limit = 100, filters: AuditEventFilters = {}) {
  const events = await prisma.documentAuditEvent.findMany({
    where: auditEventWhere(workspaceId, filters),
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
    select: {
      id: true, type: true, createdAt: true, outcome: true, sourceIp: true, detail: true,
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
    outcome: event.outcome,
    sourceIp: event.sourceIp,
    detail: event.detail,
  }))
}

/** Every event matching the filters, uncapped at 200 (the CSV export's whole reason to exist
 * rather than reusing listWorkspaceAuditEvents directly) — capped instead at a generous 10,000 so
 * a workspace with years of history can't build an unbounded response. */
export async function listWorkspaceAuditEventsForExport(workspaceId: string, filters: AuditEventFilters = {}) {
  const events = await prisma.documentAuditEvent.findMany({
    where: auditEventWhere(workspaceId, filters),
    orderBy: { createdAt: "desc" },
    take: 10_000,
    select: {
      id: true, type: true, createdAt: true, outcome: true, sourceIp: true, userAgent: true, detail: true,
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
    actorEmail: event.actor?.email ?? null,
    documentFilename: event.document?.filename ?? null,
    outcome: event.outcome,
    sourceIp: event.sourceIp,
    userAgent: event.userAgent,
    detail: event.detail,
  }))
}

/** Distinct event types that have actually occurred in this workspace — the activity page's type
 * filter dropdown, rather than the full EVENT_LABELS catalogue (most of which any one workspace
 * will never have fired). */
export async function listWorkspaceAuditEventTypes(workspaceId: string) {
  const rows = await prisma.documentAuditEvent.findMany({
    where: { workspaceId },
    distinct: ["type"],
    select: { type: true },
    orderBy: { type: "asc" },
  })
  return rows.map((row) => ({ type: row.type, label: auditEventLabel(row.type) })).sort((a, b) => a.label.localeCompare(b.label))
}

/** Distinct actors who have generated an event in this workspace — the activity page's actor
 * filter dropdown. Pulled from the audit trail itself rather than getWorkspaceMembers so a former
 * member's past actions stay filterable after they've left. */
export async function listWorkspaceAuditEventActors(workspaceId: string) {
  const rows = await prisma.documentAuditEvent.findMany({
    where: { workspaceId, actorId: { not: null } },
    distinct: ["actorId"],
    select: { actorId: true, actor: { select: { name: true, email: true } } },
  })
  return rows
    .filter((row): row is typeof row & { actorId: string } => row.actorId !== null)
    .map((row) => ({ id: row.actorId, name: row.actor?.name || row.actor?.email || row.actorId }))
    .sort((a, b) => a.name.localeCompare(b.name))
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
