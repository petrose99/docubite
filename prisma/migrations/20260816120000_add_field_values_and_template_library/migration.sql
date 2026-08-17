-- Two additive tables for the queryable extracted-data layer and the workspace template library.
--
-- document_field_values is a flattened, searchable mirror of every Document.reviewedData value,
-- kept in sync by a delete-all + createMany in the same transaction as any reviewedData write.
-- It deliberately carries NO unique constraint: the sync is a plain replace, and keeping the
-- migration free of constraint-backed indexes avoids the DROP-INDEX-on-a-constraint incident that
-- broke a fresh `npm start` before. The typed value columns power aggregation and range filters;
-- value_text is the always-present column full-text `contains` search runs against. If ILIKE over
-- value_text gets slow at scale, the upgrade path is a pg_trgm GIN index (Postgres-only, additive).
--
-- workspace_templates is the reusable, workspace-level template library. Purely additive; no data
-- backfill runs here (that is a separate idempotent script), so a fresh environment needs nothing.

-- CreateTable
CREATE TABLE "document_field_values" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "field_key" TEXT NOT NULL,
    "item_key" TEXT,
    "item_index" INTEGER,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value_text" TEXT,
    "value_number" DOUBLE PRECISION,
    "value_date" DATE,
    "value_bool" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_templates" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "doc_type" TEXT,
    "fields" JSONB NOT NULL,
    "prompt" TEXT,
    "multi_row" BOOLEAN NOT NULL DEFAULT false,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_field_values_document_id_idx" ON "document_field_values"("document_id");

-- CreateIndex
CREATE INDEX "document_field_values_workspace_id_field_key_idx" ON "document_field_values"("workspace_id", "field_key");

-- CreateIndex
CREATE INDEX "document_field_values_workspace_id_field_key_value_number_idx" ON "document_field_values"("workspace_id", "field_key", "value_number");

-- CreateIndex
CREATE INDEX "document_field_values_workspace_id_field_key_value_date_idx" ON "document_field_values"("workspace_id", "field_key", "value_date");

-- CreateIndex
CREATE INDEX "workspace_templates_workspace_id_updated_at_idx" ON "workspace_templates"("workspace_id", "updated_at");

-- AddForeignKey
ALTER TABLE "document_field_values" ADD CONSTRAINT "document_field_values_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_field_values" ADD CONSTRAINT "document_field_values_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_templates" ADD CONSTRAINT "workspace_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_templates" ADD CONSTRAINT "workspace_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
