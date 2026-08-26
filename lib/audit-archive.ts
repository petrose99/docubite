import { prisma } from "@/lib/db"
import { putDocumentSource } from "@/lib/document-storage"

/** Moves one workspace's audit trail to cold storage before the workspace row is deleted.
 *
 * DocumentAuditEvent.workspace is onDelete: Restrict specifically so a workspace delete cannot
 * silently take its audit trail with it — HIPAA §164.316(b) requires 6 years of retention
 * regardless of what happens to the workspace itself. This is the other half of that contract: it
 * writes every row to a JSON object under a path outside the workspace's own document prefix (so
 * it survives models/files.ts's blob sweep, which only ever touches document storage keys), then
 * clears the rows so the Restrict constraint stops blocking the delete.
 *
 * Not itself transactional with the delete that follows: a crash between the archive write and
 * the row deletion leaves the rows in place (safe — they still block delete) or leaves an orphaned
 * archive with no corresponding gap in the table (also safe — an extra copy of already-retained
 * data is not a compliance problem). The one failure mode this cannot tolerate is deleting the
 * rows without the archive landing first, which the ordering below prevents. */
export async function archiveWorkspaceAuditEvents(workspaceId: string): Promise<{ archived: number }> {
  const events = await prisma.documentAuditEvent.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } })
  if (events.length) {
    const key = `audit-archives/${workspaceId}/${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    await putDocumentSource(key, Buffer.from(JSON.stringify({ workspaceId, archivedAt: new Date().toISOString(), events })), "application/json")
  }
  // The append-only trigger (20260822000000_hipaa_audit_hardening) refuses DELETE on this table
  // unless app.audit_archive_delete is set for the transaction — this is the one place in the app
  // that sets it, and only after the archive write above has already landed.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.audit_archive_delete', 'true', true)`
    await tx.documentAuditEvent.deleteMany({ where: { workspaceId } })
  })
  return { archived: events.length }
}
