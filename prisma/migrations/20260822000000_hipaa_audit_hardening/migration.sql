-- HIPAA audit trail hardening (§164.312(b), §164.316(b)).
--
-- 1. Adds the columns the audit trail was missing: sourceIp/userAgent (FROM WHERE), outcome
--    (WHETHER IT SUCCEEDED), detail (WHAT EXACTLY). See lib/audit.ts, the single place that
--    writes these from now on.
-- 2. Changes the workspace FK from CASCADE to RESTRICT: a workspace delete must not be a way to
--    destroy the audit trail describing what happened inside it. See lib/audit-archive.ts, which
--    archives the rows to cold storage and clears them (via the app-role bypass below) before
--    models/workspaces.ts's deleteWorkspace can proceed.
-- 3. Changes the document FK from CASCADE to SET NULL, for the same reason at the document level:
--    purging a document must not erase the record that someone downloaded it.
-- 4. Installs an append-only trigger. UPDATE is never allowed — once written, an audit row does
--    not change. DELETE is allowed only inside a transaction that has explicitly set
--    app.audit_archive_delete = 'true', which archiveWorkspaceAuditEvents does after the archive
--    write has landed. Any other DELETE — an accidental admin query, a bug — is refused.

ALTER TABLE "document_audit_events"
  ADD COLUMN "source_ip" TEXT,
  ADD COLUMN "user_agent" TEXT,
  ADD COLUMN "outcome" TEXT NOT NULL DEFAULT 'success',
  ADD COLUMN "detail" JSONB;

ALTER TABLE "document_audit_events" DROP CONSTRAINT "document_audit_events_workspace_id_fkey";
ALTER TABLE "document_audit_events"
  ADD CONSTRAINT "document_audit_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT;

ALTER TABLE "document_audit_events" DROP CONSTRAINT "document_audit_events_document_id_fkey";
ALTER TABLE "document_audit_events"
  ADD CONSTRAINT "document_audit_events_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL;

CREATE INDEX "document_audit_document_created_idx" ON "document_audit_events"("document_id", "created_at");
CREATE INDEX "document_audit_actor_created_idx" ON "document_audit_events"("actor_id", "created_at");

CREATE OR REPLACE FUNCTION document_audit_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'document_audit_events is append-only: rows cannot be modified after they are written';
  END IF;
  IF TG_OP = 'DELETE' AND coalesce(current_setting('app.audit_archive_delete', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'document_audit_events rows may only be removed via the audit archival path (lib/audit-archive.ts)';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS document_audit_events_append_only_trigger ON "document_audit_events";
CREATE TRIGGER document_audit_events_append_only_trigger
  BEFORE UPDATE OR DELETE ON "document_audit_events"
  FOR EACH ROW EXECUTE FUNCTION document_audit_events_append_only();
