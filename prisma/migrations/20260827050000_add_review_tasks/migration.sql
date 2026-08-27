-- WP10: the accounting review queue. Workspace-scoped, gets the standard RLS policy shape —
-- inert until RLS is ENABLEd, same as every table added since 20260819190000.
CREATE TABLE "review_tasks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reason" TEXT NOT NULL DEFAULT 'manual',
    "assignee_id" UUID,
    "detail" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "due_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    CONSTRAINT "review_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "review_tasks_workspace_id_status_created_at_idx" ON "review_tasks"("workspace_id", "status", "created_at");
CREATE INDEX "review_tasks_workspace_id_assignee_id_status_idx" ON "review_tasks"("workspace_id", "assignee_id", "status");
CREATE INDEX "review_tasks_document_id_idx" ON "review_tasks"("document_id");

ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "review_tasks" ADD CONSTRAINT "review_tasks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP POLICY IF EXISTS "review_tasks_workspace_isolation" ON "review_tasks";
CREATE POLICY "review_tasks_workspace_isolation" ON "review_tasks" USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace());
