-- Dext-parity Phase 3 WP3.3: expense claims, grouping one or more expense_receipt Documents under
-- one submitter/status/total. Reuses approval_workflows/approval_workflow_stages via its own
-- workflow_id/current_stage_index pair, exactly as review_tasks already does.

CREATE TABLE "expense_claims" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "submitter_id" UUID,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "total" DOUBLE PRECISION,
    "currency_code" TEXT,
    "workflow_id" UUID,
    "current_stage_index" INTEGER,
    "submitted_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "expense_claims_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "expense_claims_workspace_id_status_created_at_idx" ON "expense_claims"("workspace_id", "status", "created_at");
CREATE INDEX "expense_claims_workspace_id_submitter_id_idx" ON "expense_claims"("workspace_id", "submitter_id");
CREATE INDEX "expense_claims_workflow_id_idx" ON "expense_claims"("workflow_id");

ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_submitter_id_fkey" FOREIGN KEY ("submitter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "approval_workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP POLICY IF EXISTS "expense_claims_workspace_isolation" ON "expense_claims";
CREATE POLICY "expense_claims_workspace_isolation" ON "expense_claims"
  USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace());

CREATE TABLE "expense_claim_items" (
    "id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "expense_claim_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "expense_claim_items_claim_id_document_id_key" ON "expense_claim_items"("claim_id", "document_id");
CREATE INDEX "expense_claim_items_workspace_id_idx" ON "expense_claim_items"("workspace_id");
CREATE INDEX "expense_claim_items_document_id_idx" ON "expense_claim_items"("document_id");

ALTER TABLE "expense_claim_items" ADD CONSTRAINT "expense_claim_items_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "expense_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expense_claim_items" ADD CONSTRAINT "expense_claim_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "expense_claim_items" ADD CONSTRAINT "expense_claim_items_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP POLICY IF EXISTS "expense_claim_items_workspace_isolation" ON "expense_claim_items";
CREATE POLICY "expense_claim_items_workspace_isolation" ON "expense_claim_items"
  USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace());
