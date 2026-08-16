-- The spreadsheet engine: a Univer workbook snapshot per file, a cache for the AI formulas that
-- run inside it, and the two pointers that tie extraction to the grid.
--
-- Purely additive on purpose. Nothing here alters or drops an existing column, so applying it to
-- a database mid-flight cannot disturb the document/worksheet tables the app already serves.

CREATE TABLE "spreadsheet_workbooks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "rev" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "spreadsheet_workbooks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "spreadsheet_workbooks_file_id_key" ON "spreadsheet_workbooks"("file_id");
CREATE INDEX "spreadsheet_workbooks_workspace_id_idx" ON "spreadsheet_workbooks"("workspace_id");

ALTER TABLE "spreadsheet_workbooks" ADD CONSTRAINT "spreadsheet_workbooks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "spreadsheet_workbooks" ADD CONSTRAINT "spreadsheet_workbooks_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "document_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ai_formula_cache" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "hash" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_formula_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_formula_cache_workspace_id_hash_key" ON "ai_formula_cache"("workspace_id", "hash");

ALTER TABLE "ai_formula_cache" ADD CONSTRAINT "ai_formula_cache_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Which Univer tab a worksheet's extraction config writes into, and whether a document's rows
-- have already been appended to the grid (this is what keeps the bridge idempotent).
ALTER TABLE "document_templates" ADD COLUMN "univer_sheet_id" TEXT;
ALTER TABLE "documents" ADD COLUMN "sheet_applied_at" TIMESTAMP(3);
