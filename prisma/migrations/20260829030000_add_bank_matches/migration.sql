-- WP2.1/WP2.3: bank statement + supplier statement reconciliation matches.
CREATE TABLE "bank_matches" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "statement_document_id" UUID NOT NULL,
    "transaction_index" INTEGER NOT NULL,
    "matched_document_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'bank',
    "date_delta_days" INTEGER,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bank_matches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bank_matches_workspace_id_kind_statement_document_id_tran_key" ON "bank_matches"("workspace_id", "kind", "statement_document_id", "transaction_index", "matched_document_id");
CREATE INDEX "bank_matches_workspace_id_statement_document_id_idx" ON "bank_matches"("workspace_id", "statement_document_id");
CREATE INDEX "bank_matches_workspace_id_matched_document_id_idx" ON "bank_matches"("workspace_id", "matched_document_id");

ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_statement_document_id_fkey" FOREIGN KEY ("statement_document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_matched_document_id_fkey" FOREIGN KEY ("matched_document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP POLICY IF EXISTS "bank_matches_workspace_isolation" ON "bank_matches";
CREATE POLICY "bank_matches_workspace_isolation" ON "bank_matches"
  USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace());
