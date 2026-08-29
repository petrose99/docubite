-- Dext-parity Phase 3 WP3.1: multi-stage approval workflows, optionally attached to a ReviewTask.

CREATE TABLE "approval_workflows" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "approval_workflows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "approval_workflows_workspace_id_active_idx" ON "approval_workflows"("workspace_id", "active");

ALTER TABLE "approval_workflows" ADD CONSTRAINT "approval_workflows_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_workflows" ADD CONSTRAINT "approval_workflows_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP POLICY IF EXISTS "approval_workflows_workspace_isolation" ON "approval_workflows";
CREATE POLICY "approval_workflows_workspace_isolation" ON "approval_workflows"
  USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace());

CREATE TABLE "approval_workflow_stages" (
    "id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "stage_index" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "require_owner" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "approval_workflow_stages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "approval_workflow_stages_workflow_id_stage_index_key" ON "approval_workflow_stages"("workflow_id", "stage_index");
CREATE INDEX "approval_workflow_stages_workspace_id_idx" ON "approval_workflow_stages"("workspace_id");

ALTER TABLE "approval_workflow_stages" ADD CONSTRAINT "approval_workflow_stages_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "approval_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_workflow_stages" ADD CONSTRAINT "approval_workflow_stages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP POLICY IF EXISTS "approval_workflow_stages_workspace_isolation" ON "approval_workflow_stages";
CREATE POLICY "approval_workflow_stages_workspace_isolation" ON "approval_workflow_stages"
  USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace());

-- Both nullable: a plain ReviewTask (no workflow) behaves exactly as before.
ALTER TABLE "review_tasks" ADD COLUMN "workflow_id" UUID;
ALTER TABLE "review_tasks" ADD COLUMN "current_stage_index" INTEGER;

CREATE INDEX "review_tasks_workflow_id_idx" ON "review_tasks"("workflow_id");

ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "approval_workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;
