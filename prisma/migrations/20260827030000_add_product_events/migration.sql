-- WP5: first-party product analytics. Deliberately not workspace-scoped (see the model's own
-- comment) — admin rollups read across every workspace, the same reasoning as
-- stripe_webhook_events and admin_audit_events, so no RLS policy is added either.
CREATE TABLE "product_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID,
    "actor_id" UUID,
    "name" TEXT NOT NULL,
    "props" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_events_workspace_id_created_at_idx" ON "product_events"("workspace_id", "created_at");
CREATE INDEX "product_events_name_created_at_idx" ON "product_events"("name", "created_at");

ALTER TABLE "product_events" ADD CONSTRAINT "product_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
