-- WP11: supplier automation rules, plus the two columns on documents that record what a rule did
-- to a document (coding_data) and which rule did it (applied_rule_id).
CREATE TABLE "automation_rules" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "matcher" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "min_confidence" DOUBLE PRECISION,
    "require_review" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "automation_rules_workspace_id_is_active_idx" ON "automation_rules"("workspace_id", "is_active");

ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documents" ADD COLUMN "coding_data" JSONB;
ALTER TABLE "documents" ADD COLUMN "applied_rule_id" UUID;
ALTER TABLE "documents" ADD CONSTRAINT "documents_applied_rule_id_fkey" FOREIGN KEY ("applied_rule_id") REFERENCES "automation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP POLICY IF EXISTS "automation_rules_workspace_isolation" ON "automation_rules";
CREATE POLICY "automation_rules_workspace_isolation" ON "automation_rules" USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace());
