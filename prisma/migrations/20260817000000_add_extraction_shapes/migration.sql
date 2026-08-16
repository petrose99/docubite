-- Same-shape re-runs: a workspace-level library of the extraction setups that have been used, so
-- the next similar upload can be matched to one and offered "same as last time?". One shape per
-- worksheet (template), refreshed each time that worksheet extracts a document.
--
-- Purely additive: a new table plus two nullable columns and an index on documents. Existing rows
-- get a null shape and null classification, which every read path treats as "no shape known yet".

CREATE TABLE "extraction_shapes" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "template_id" UUID,
    "name" TEXT NOT NULL,
    "doc_type" TEXT,
    "entity" TEXT,
    "fields" JSONB NOT NULL,
    "prompt" TEXT,
    "multi_row" BOOLEAN NOT NULL DEFAULT false,
    "signature" JSONB NOT NULL,
    "last_document_id" UUID,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "extraction_shapes_pkey" PRIMARY KEY ("id")
);

-- One shape per worksheet. template_id is nullable (a worksheet can be deleted out from under its
-- shape); Postgres treats NULLs as distinct, so several template-less shapes may coexist.
CREATE UNIQUE INDEX "extraction_shapes_template_id_key" ON "extraction_shapes"("template_id");
CREATE INDEX "extraction_shapes_workspace_id_idx" ON "extraction_shapes"("workspace_id");

ALTER TABLE "extraction_shapes" ADD CONSTRAINT "extraction_shapes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "extraction_shapes" ADD CONSTRAINT "extraction_shapes_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "document_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Which shape a document was stamped with (for the run diff) and its classification (doc_type,
-- entity, period), reused by the folder report in F3.
ALTER TABLE "documents" ADD COLUMN "shape_id" UUID;
ALTER TABLE "documents" ADD COLUMN "classification" JSONB;
CREATE INDEX "documents_shape_id_idx" ON "documents"("shape_id");
ALTER TABLE "documents" ADD CONSTRAINT "documents_shape_id_fkey" FOREIGN KEY ("shape_id") REFERENCES "extraction_shapes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
