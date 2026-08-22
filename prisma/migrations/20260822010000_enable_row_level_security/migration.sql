-- Switches on the RLS machinery installed (inert) by 20260819190000_add_row_level_security.
--
-- ENABLE alone is not enough: Postgres exempts the table OWNER from its own RLS policies unless
-- FORCE is also set, and on this database the app connects AS the table owner. FORCE is what
-- actually stands between the app's own connection and the policy — without it this migration
-- would enable RLS and change nothing, because the owner would keep bypassing it.
--
-- FORCE does not help against a true Postgres SUPERUSER, which always bypasses RLS regardless.
-- RDS's master user carries the rds_superuser role but is deliberately NOT granted the actual
-- SUPERUSER attribute (AWS withholds it), so FORCE does bind it — but scripts/create-app-role.sql
-- still creates a narrower, non-superuser role as defense in depth, so tenant isolation does not
-- rest entirely on a fact about how RDS configures its master user.
--
-- Applying this is still safe with DB_RLS_ENABLED unset/false: every policy compares workspace_id
-- to app_current_workspace(), which reads current_setting('app.workspace_id', true) and returns
-- NULL when unset — and NULL never equals any workspace_id, so an unset scope denies all rows
-- rather than exposing them. The blast radius of turning this on before every call site has been
-- swept to withWorkspace() is therefore "queries that don't set the scope see nothing", not "see
-- everything" — annoying to debug, but the fail-safe direction.
--
-- DO NOT set DB_RLS_ENABLED=true in production until lib/db-rls.ts's withWorkspace() has been
-- adopted across the read/write paths listed in the HIPAA remediation plan (Phase 1.2). Applying
-- this migration does not itself require that — it only takes effect for connections made through
-- the app role once that role exists.

DO $$
DECLARE
  target text;
  tables text[] := ARRAY[
    'documents', 'document_files', 'document_folders', 'document_templates', 'document_chunks',
    'document_field_values', 'document_processing_jobs', 'document_audit_events',
    'document_report_drafts', 'report_templates', 'extraction_shapes', 'spreadsheet_workbooks',
    'ai_formula_cache', 'workspace_usage_periods', 'workspace_subscriptions'
  ];
BEGIN
  FOREACH target IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = target) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    END IF;
  END LOOP;
END $$;
