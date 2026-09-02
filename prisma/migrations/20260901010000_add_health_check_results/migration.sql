-- Data Health Phase A: one open (or since-decided) finding produced by a lib/health/checks/*
-- check run. fingerprint is the app-computed dedupe key
-- (`${checkCode}:${documentId ?? ""}:${externalTransactionId ?? ""}`) — a single computed string
-- column rather than a compound unique over the nullable columns, since Postgres treats NULLs as
-- distinct in a unique index and would not dedupe on that shape.
CREATE TABLE "health_check_results" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "check_code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "document_id" UUID,
    "external_transaction_id" TEXT,
    "suggested_action" TEXT,
    "suggested_action_payload" JSONB,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" UUID,
    "resolved_action" TEXT,
    "dismissed_at" TIMESTAMP(3),
    "dismissed_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "health_check_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "health_check_results_workspace_id_fingerprint_key" ON "health_check_results"("workspace_id", "fingerprint");
CREATE INDEX "health_check_results_workspace_id_status_category_idx" ON "health_check_results"("workspace_id", "status", "category");
CREATE INDEX "health_check_results_workspace_id_check_code_idx" ON "health_check_results"("workspace_id", "check_code");

ALTER TABLE "health_check_results" ADD CONSTRAINT "health_check_results_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_check_results" ADD CONSTRAINT "health_check_results_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_check_results" ADD CONSTRAINT "health_check_results_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "health_check_results" ADD CONSTRAINT "health_check_results_dismissed_by_id_fkey" FOREIGN KEY ("dismissed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP POLICY IF EXISTS "health_check_results_workspace_isolation" ON "health_check_results";
CREATE POLICY "health_check_results_workspace_isolation" ON "health_check_results"
  USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace());
