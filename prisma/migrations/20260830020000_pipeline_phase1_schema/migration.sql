-- Pipeline redesign Phase 1: additive-only schema for the document pipeline (Inbox / To review /
-- Ready / Approvals / Archive). Nullable columns + a new table; no backfill, no data migration.
-- See lib/documents/stages.ts for the derived-stage vocabulary this schema supports.

-- 1. documents.archived_at / flagged_at / flagged_by_id
--
-- Archive is a separate axis from `status`, not a status value: a document can be archived at any
-- lifecycle point, and this avoids rewriting `reviewed` history. NULL means not archived.
ALTER TABLE "documents" ADD COLUMN "archived_at" TIMESTAMP(3);

-- A reviewer's manual "look at this" flag on the pipeline list, independent of status/confidence.
ALTER TABLE "documents" ADD COLUMN "flagged_at" TIMESTAMP(3);
ALTER TABLE "documents" ADD COLUMN "flagged_by_id" UUID;

ALTER TABLE "documents" ADD CONSTRAINT "documents_flagged_by_id_fkey"
  FOREIGN KEY ("flagged_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A flag is attributable by definition, mirroring the transcript-edit CHECK a few migrations back.
ALTER TABLE "documents" ADD CONSTRAINT "documents_flagged_attributable"
  CHECK (("flagged_at" IS NULL) = ("flagged_by_id" IS NULL));

CREATE INDEX "documents_workspace_id_archived_at_idx" ON "documents" ("workspace_id", "archived_at");

-- 2. document_files.kind = 'pipeline'
--
-- One app-managed per-workspace container for pipeline uploads, mirroring the 'dictation' kind
-- added in 20260819210000_add_dictation_page — so a pipeline upload never forces a
-- spreadsheet/file choice. Partial unique index enforces "one per workspace" in the database
-- rather than in ensurePipelineFile's own logic.
CREATE UNIQUE INDEX "document_files_workspace_id_pipeline_key"
  ON "document_files" ("workspace_id") WHERE "kind" = 'pipeline';

-- 3. user_list_preferences
--
-- Per-user, per-workspace, per-view (viewKey) column/filter/sort preferences for the pipeline
-- list. Server-side so a preference set on one device survives a switch to another.
CREATE TABLE "user_list_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "view_key" TEXT NOT NULL,
    "columns" JSONB NOT NULL,
    "filters" JSONB NOT NULL,
    "sort" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_list_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_list_preferences_user_id_workspace_id_view_key_key"
  ON "user_list_preferences" ("user_id", "workspace_id", "view_key");

ALTER TABLE "user_list_preferences" ADD CONSTRAINT "user_list_preferences_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_list_preferences" ADD CONSTRAINT "user_list_preferences_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Inert until RLS is ENABLEd, same as every table added since 20260819190000.
DROP POLICY IF EXISTS "user_list_preferences_workspace_isolation" ON "user_list_preferences";
CREATE POLICY "user_list_preferences_workspace_isolation" ON "user_list_preferences"
  USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace());
