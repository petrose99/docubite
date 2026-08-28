-- Fixes a real bug in the append-only trigger from 20260822000000_hipaa_audit_hardening: its
-- UPDATE branch raised unconditionally, with no exception for the two FK columns on this very
-- table that are themselves ON DELETE SET NULL (document_id, actor_id). Postgres enforces a SET
-- NULL action as an UPDATE, so deleting ANY document or user that has ever had an audit event
-- written against it — which is nearly all of them, since document_reviewed/document_field_edited/
-- document_coding_set/etc. all write one — hit this trigger and the delete failed outright. This
-- was undetected because vitest mocks Prisma entirely (the trigger only fires against a real
-- Postgres connection) and local dev runs DB_SCOPE_GUARD in "warn" mode by default, which doesn't
-- surface unrelated database errors either; a real end-to-end run against the Docker dev database
-- with DB_SCOPE_GUARD=throw is what actually exercised a document/workspace delete and hit it.
--
-- The fix: the UPDATE branch now allows exactly the SET NULL cascade — document_id or actor_id
-- moving from a value to NULL — and still rejects every other change, including setting either
-- column to some OTHER non-null value (which would be tampering, not a FK action) or touching any
-- other column at all.
CREATE OR REPLACE FUNCTION document_audit_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.source_ip IS DISTINCT FROM OLD.source_ip
       OR NEW.user_agent IS DISTINCT FROM OLD.user_agent
       OR NEW.outcome IS DISTINCT FROM OLD.outcome
       OR NEW.detail IS DISTINCT FROM OLD.detail
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR (NEW.document_id IS DISTINCT FROM OLD.document_id AND NEW.document_id IS NOT NULL)
       OR (NEW.actor_id IS DISTINCT FROM OLD.actor_id AND NEW.actor_id IS NOT NULL)
    THEN
      RAISE EXCEPTION 'document_audit_events is append-only: rows cannot be modified after they are written';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND coalesce(current_setting('app.audit_archive_delete', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'document_audit_events rows may only be removed via the audit archival path (lib/audit-archive.ts)';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
