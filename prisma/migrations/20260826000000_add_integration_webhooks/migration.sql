-- Outbound integrations, part 1: API keys and HMAC-signed webhook deliveries (the Zapier-ready
-- foundation). Three workspace-scoped tables. The delivery row IS the queue row — modelled on
-- stripe_webhook_events (status/attempts/lease/next_attempt_at), NOT on document_processing_jobs,
-- whose 14-minute lease and documentId-shaped drain are wrong for a 10-second HTTP POST.
--
-- All three carry workspace_id and are added to the row-level-security policy set at the bottom,
-- exactly as 20260819190000 did for the existing tenant tables. Like those, the policies are inert
-- until RLS is ENABLEd (still deliberately not done here).

CREATE TABLE "workspace_api_keys" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_by_id" UUID,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workspace_api_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_endpoints" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "secret_enc" TEXT NOT NULL,
    "events" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "document_id" UUID,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMP(3),
    "response_status" INTEGER,
    "error_code" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_api_keys_key_hash_key" ON "workspace_api_keys"("key_hash");
CREATE INDEX "workspace_api_keys_workspace_id_idx" ON "workspace_api_keys"("workspace_id");
CREATE INDEX "webhook_endpoints_workspace_id_idx" ON "webhook_endpoints"("workspace_id");
-- The drain's hot path: claim the oldest due pending/failed delivery.
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "webhook_deliveries"("status", "next_attempt_at");
-- The settings "recent deliveries" list, newest-first within a workspace.
CREATE INDEX "webhook_deliveries_workspace_id_created_at_idx" ON "webhook_deliveries"("workspace_id", "created_at");
CREATE INDEX "webhook_deliveries_endpoint_id_idx" ON "webhook_deliveries"("endpoint_id");

ALTER TABLE "workspace_api_keys" ADD CONSTRAINT "workspace_api_keys_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_api_keys" ADD CONSTRAINT "workspace_api_keys_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Row-level security policies for the three new tables. Mirrors 20260819190000 exactly: the policy
-- compares the row's workspace_id against app_current_workspace() (the app.workspace_id session
-- setting), and is INERT until RLS is ENABLEd on the table — which, as there, is left for the
-- deliberate, reversible rollout step and is NOT done in this migration.
--
-- app_current_workspace() is created by 20260819190000 and reused here.
DO $$
DECLARE
  target text;
  tables text[] := ARRAY['workspace_api_keys', 'webhook_endpoints', 'webhook_deliveries'];
BEGIN
  FOREACH target IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', target || '_workspace_isolation', target);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace())',
      target || '_workspace_isolation', target
    );
  END LOOP;
END $$;
