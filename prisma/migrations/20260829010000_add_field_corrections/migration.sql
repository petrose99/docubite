-- WP1.3: few-shot correction memory fed back into future extraction prompts.
CREATE TABLE "field_corrections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "template_code" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "supplier" TEXT,
    "wrong_value" TEXT NOT NULL,
    "corrected_value" TEXT NOT NULL,
    "hit_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "field_corrections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "field_corrections_workspace_id_template_code_field_key_wr_key" ON "field_corrections"("workspace_id", "template_code", "field_key", "wrong_value", "corrected_value");
CREATE INDEX "field_corrections_workspace_id_template_code_field_key_upd_idx" ON "field_corrections"("workspace_id", "template_code", "field_key", "updated_at");

ALTER TABLE "field_corrections" ADD CONSTRAINT "field_corrections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP POLICY IF EXISTS "field_corrections_workspace_isolation" ON "field_corrections";
CREATE POLICY "field_corrections_workspace_isolation" ON "field_corrections"
  USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace());
