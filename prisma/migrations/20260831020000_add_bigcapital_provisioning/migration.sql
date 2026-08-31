-- Bigcapital accounting bridge, part 1: auto-provisioned per-workspace tenants. Unlike
-- integration_connections' OAuth providers (QuickBooks/Xero), Bigcapital has no connect redirect —
-- a real Bigcapital user account is created on the user's behalf (bigcapital_accounts, one per
-- DocuBite user) and used to build an isolated organization per workspace. That organization's API
-- key still lands in integration_connections (provider = 'bigcapital'), reusing the existing push/
-- sync machinery unchanged. integration_provision_jobs is the durable queue row for the build step,
-- on the same status/attempts/lease/next_attempt_at shape as integration_pushes.

CREATE TABLE "bigcapital_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "bigcapital_user_id" TEXT,
    "email" TEXT NOT NULL,
    "password_enc" TEXT NOT NULL,
    "master_token_enc" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bigcapital_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_provision_jobs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'bigcapital',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMP(3),
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "integration_provision_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bigcapital_accounts_user_id_key" ON "bigcapital_accounts"("user_id");
CREATE UNIQUE INDEX "integration_provision_jobs_workspace_id_provider_key" ON "integration_provision_jobs"("workspace_id", "provider");
-- The drain's hot path: claim the oldest due pending job.
CREATE INDEX "integration_provision_jobs_status_next_attempt_at_idx" ON "integration_provision_jobs"("status", "next_attempt_at");

ALTER TABLE "bigcapital_accounts" ADD CONSTRAINT "bigcapital_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_provision_jobs" ADD CONSTRAINT "integration_provision_jobs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Row-level security for integration_provision_jobs, mirroring 20260826010000 exactly. Inert until
-- RLS is ENABLEd on the table. bigcapital_accounts is user-scoped, not workspace-scoped, so it gets
-- no workspace_isolation policy — same as `users` itself.
DO $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'integration_provision_jobs_workspace_isolation', 'integration_provision_jobs');
  EXECUTE format(
    'CREATE POLICY %I ON %I USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace())',
    'integration_provision_jobs_workspace_isolation', 'integration_provision_jobs'
  );
END $$;
