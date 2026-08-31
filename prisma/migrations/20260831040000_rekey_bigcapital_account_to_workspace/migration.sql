-- Corrects a design assumption disproven against a real running Bigcapital instance: an account can
-- build exactly ONE organization, ever (a second build fails with TENANT_ALREADY_BUILT). One
-- Bigcapital login reused across a DocuBite user's several workspaces (the original design) is
-- therefore impossible — bigcapital_accounts must be keyed per WORKSPACE instead, each with its own
-- signup under a `+ws_<workspaceId>` alias of the triggering user's email (see models/bigcapital.ts).
-- No production data exists for this table yet (P1 shipped without BIGCAPITAL_ENABLED ever being
-- turned on), so this drops and re-adds rather than migrating rows.

ALTER TABLE "bigcapital_accounts" DROP CONSTRAINT "bigcapital_accounts_user_id_fkey";
DROP INDEX "bigcapital_accounts_user_id_key";

ALTER TABLE "bigcapital_accounts" RENAME COLUMN "user_id" TO "workspace_id";
ALTER TABLE "bigcapital_accounts" ADD COLUMN "user_id" UUID NOT NULL;
ALTER TABLE "bigcapital_accounts" ADD COLUMN "organization_id" TEXT;

CREATE UNIQUE INDEX "bigcapital_accounts_workspace_id_key" ON "bigcapital_accounts"("workspace_id");

ALTER TABLE "bigcapital_accounts" ADD CONSTRAINT "bigcapital_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bigcapital_accounts" ADD CONSTRAINT "bigcapital_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
