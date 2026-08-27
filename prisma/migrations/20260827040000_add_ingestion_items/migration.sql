-- WP9: a durable per-intake-item ledger, independent of the Document it may or may not produce.
-- Workspace-scoped table, so it gets the same RLS policy shape as every other one added since
-- 20260819190000 — inert until RLS is ENABLEd.
CREATE TABLE "ingestion_items" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "document_id" UUID,
    "source" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "malware_status" TEXT NOT NULL DEFAULT 'pending',
    "status" TEXT NOT NULL DEFAULT 'received',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMP(3),
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ingestion_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ingestion_items_workspace_id_idempotency_key_key" ON "ingestion_items"("workspace_id", "idempotency_key");
CREATE INDEX "ingestion_items_workspace_id_created_at_idx" ON "ingestion_items"("workspace_id", "created_at");
CREATE INDEX "ingestion_items_document_id_idx" ON "ingestion_items"("document_id");

ALTER TABLE "ingestion_items" ADD CONSTRAINT "ingestion_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ingestion_items" ADD CONSTRAINT "ingestion_items_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP POLICY IF EXISTS "ingestion_items_workspace_isolation" ON "ingestion_items";
CREATE POLICY "ingestion_items_workspace_isolation" ON "ingestion_items" USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace());
