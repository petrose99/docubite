-- Postgres row-level security: tenant isolation enforced by the database rather than by every
-- query author remembering.
--
-- THIS IS THE RISKIEST CHANGE IN THE PLAN and is written to be inert until deliberately switched
-- on. Creating a policy does nothing until RLS is ENABLED on the table, and enabling it is the
-- separate, reversible step at the bottom of this file — commented out. Applying this migration
-- therefore changes NO behaviour; it installs the machinery.
--
-- The mechanism: each policy compares the row's workspace_id against `app.workspace_id`, a
-- session setting the application sets per transaction (see withWorkspace in lib/db-rls.ts).
-- current_setting(..., true) returns NULL rather than erroring when unset, and a NULL comparison
-- yields no rows — so an unset scope fails CLOSED.
--
-- SET LOCAL, not SET: the setting must live and die with one transaction. Under PgBouncer's
-- transaction pooling a connection is handed to another request the moment a transaction ends, and
-- a session-level setting would leak one tenant's scope into another tenant's query. That is the
-- single detail that decides whether RLS is a safety feature or a data-leak bug.

CREATE OR REPLACE FUNCTION app_current_workspace() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

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
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', target || '_workspace_isolation', target);
      -- USING governs which rows are visible to reads/updates/deletes; WITH CHECK governs which
      -- rows may be written. Both are required: USING alone would let a row be written into
      -- another workspace even though it could not then be read back.
      EXECUTE format(
        'CREATE POLICY %I ON %I USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace())',
        target || '_workspace_isolation', target
      );
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- ENABLING RLS — deliberately NOT done here.
--
-- Run this only after DB_SCOPE_GUARD=throw has held in production, and against a non-superuser
-- application role (RLS is bypassed by superusers and by the table owner unless FORCE is used,
-- so on a database where the app connects as the owner the FORCE variant is the one that matters):
--
--   ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
--   -- ... and so on for each table above.
--
-- To roll back, DISABLE ROW LEVEL SECURITY on the table; the policies can stay in place, inert.
-- ---------------------------------------------------------------------------------------------
