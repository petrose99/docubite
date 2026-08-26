-- Outbound integrations, part 2: push extracted invoices/receipts to QuickBooks or Xero as bills
-- (P2). Two workspace-scoped tables, modelled directly on 20260826000000_add_integration_webhooks:
-- integration_connections is the OAuth connector (one per workspace+provider, tokens AES-GCM-sealed
-- exactly like webhook_endpoints.secret_enc); integration_pushes IS the queue row, on the same
-- status/attempts/lease/next_attempt_at shape as webhook_deliveries, drained by the shared
-- claim/process/drain trio in lib/integration-push.ts.
--
-- Both carry workspace_id and are added to the row-level-security policy set at the bottom, exactly
-- as 20260826000000 did. The policies are inert until RLS is ENABLEd (still not done here).

CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_tenant_id" TEXT,
    "tenant_name" TEXT,
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT NOT NULL,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "default_expense_account_id" TEXT,
    "default_expense_account_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_pushes" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMP(3),
    "external_bill_id" TEXT,
    "error_code" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "integration_pushes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_connections_workspace_id_provider_key" ON "integration_connections"("workspace_id", "provider");
CREATE UNIQUE INDEX "integration_pushes_document_id_connection_id_key" ON "integration_pushes"("document_id", "connection_id");
-- The drain's hot path: claim the oldest due pending push.
CREATE INDEX "integration_pushes_status_next_attempt_at_idx" ON "integration_pushes"("status", "next_attempt_at");
-- The document page / settings "recent pushes" list, newest-first within a workspace.
CREATE INDEX "integration_pushes_workspace_id_created_at_idx" ON "integration_pushes"("workspace_id", "created_at");

ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "integration_pushes" ADD CONSTRAINT "integration_pushes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_pushes" ADD CONSTRAINT "integration_pushes_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_pushes" ADD CONSTRAINT "integration_pushes_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_pushes" ADD CONSTRAINT "integration_pushes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Row-level security policies for the two new tables. Mirrors 20260826000000 exactly: the policy
-- compares the row's workspace_id against app_current_workspace() (the app.workspace_id session
-- setting), and is INERT until RLS is ENABLEd on the table — which, as there, is left for the
-- deliberate, reversible rollout step and is NOT done in this migration.
--
-- app_current_workspace() is created by 20260819190000 and reused here.
DO $$
DECLARE
  target text;
  tables text[] := ARRAY['integration_connections', 'integration_pushes'];
BEGIN
  FOREACH target IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', target || '_workspace_isolation', target);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace())',
      target || '_workspace_isolation', target
    );
  END LOOP;
END $$;
