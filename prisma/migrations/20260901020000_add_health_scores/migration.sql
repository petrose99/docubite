-- Data Health Phase A: append-only, one row per workspace per day, written by
-- computeAndSnapshotHealthScore. Unique on (workspace_id, computed_on) so a same-day rerun
-- updates in place rather than accumulating duplicate same-day rows.
CREATE TABLE "health_scores" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "computed_on" DATE NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "breakdown" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "health_scores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "health_scores_workspace_id_computed_on_key" ON "health_scores"("workspace_id", "computed_on");
CREATE INDEX "health_scores_workspace_id_computed_on_idx" ON "health_scores"("workspace_id", "computed_on");

ALTER TABLE "health_scores" ADD CONSTRAINT "health_scores_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP POLICY IF EXISTS "health_scores_workspace_isolation" ON "health_scores";
CREATE POLICY "health_scores_workspace_isolation" ON "health_scores"
  USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace());
