-- Data Health Phase A: per-workspace override of one check's enabled/weight state. No row means
-- "use the check's own CheckDefinition.defaultWeight" (lib/health/score.ts's computeHealthScore).
CREATE TABLE "health_score_configs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "check_code" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "weight" DOUBLE PRECISION,
    CONSTRAINT "health_score_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "health_score_configs_workspace_id_check_code_key" ON "health_score_configs"("workspace_id", "check_code");

ALTER TABLE "health_score_configs" ADD CONSTRAINT "health_score_configs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP POLICY IF EXISTS "health_score_configs_workspace_isolation" ON "health_score_configs";
CREATE POLICY "health_score_configs_workspace_isolation" ON "health_score_configs"
  USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace());
