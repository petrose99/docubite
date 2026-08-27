-- WP12: deterministic check results, one row per (document, check), upserted on every run.
CREATE TABLE "document_check_results" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "check_code" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "document_check_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_check_results_document_id_check_code_key" ON "document_check_results"("document_id", "check_code");
CREATE INDEX "document_check_results_workspace_id_status_idx" ON "document_check_results"("workspace_id", "status");

ALTER TABLE "document_check_results" ADD CONSTRAINT "document_check_results_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_check_results" ADD CONSTRAINT "document_check_results_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP POLICY IF EXISTS "document_check_results_workspace_isolation" ON "document_check_results";
CREATE POLICY "document_check_results_workspace_isolation" ON "document_check_results" USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace());
