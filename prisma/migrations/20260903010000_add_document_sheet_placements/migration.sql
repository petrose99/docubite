-- Tracks which documents have been placed into which user sheets (Phase 3).
-- A document can sit in many sheets; sheetAppliedAt stays for the pipeline container reconcile.
CREATE TABLE "document_sheet_placements" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "univer_sheet_id" TEXT NOT NULL,
    "row_start" INTEGER,
    "row_count" INTEGER NOT NULL DEFAULT 1,
    "placed_by_id" UUID NOT NULL,
    "placed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "document_sheet_placements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_sheet_placements_file_id_document_id_univer_sheet_id_key"
    ON "document_sheet_placements"("file_id", "document_id", "univer_sheet_id");

CREATE INDEX "document_sheet_placements_workspace_id_idx"
    ON "document_sheet_placements"("workspace_id");

ALTER TABLE "document_sheet_placements"
    ADD CONSTRAINT "document_sheet_placements_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_sheet_placements"
    ADD CONSTRAINT "document_sheet_placements_file_id_fkey"
    FOREIGN KEY ("file_id") REFERENCES "document_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_sheet_placements"
    ADD CONSTRAINT "document_sheet_placements_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_sheet_placements"
    ADD CONSTRAINT "document_sheet_placements_placed_by_id_fkey"
    FOREIGN KEY ("placed_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: workspace members can manage their own placements
ALTER TABLE "document_sheet_placements" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_member_placements" ON "document_sheet_placements"
    USING ("workspace_id" IN (SELECT "workspace_id" FROM "workspace_memberships" WHERE "user_id" = auth.uid()));
