-- Finance-only refactor: collapse every workspace onto the finance industry, turn off HIPAA
-- mode (the toggle that presumed a non-finance industry no longer exists in the UI), and drop the
-- pricing-tier/billing tables now that every workspace is unconditionally unlocked.

UPDATE "workspaces" SET "industry" = 'finance' WHERE "industry" != 'finance';
UPDATE "workspaces" SET "hipaa_mode" = false WHERE "hipaa_mode" = true;

ALTER TABLE "workspaces" ALTER COLUMN "industry" SET DEFAULT 'finance';

-- DropForeignKey
ALTER TABLE "workspace_subscriptions" DROP CONSTRAINT IF EXISTS "workspace_subscriptions_workspace_id_fkey";
ALTER TABLE "workspace_usage_periods" DROP CONSTRAINT IF EXISTS "workspace_usage_periods_workspace_id_fkey";
ALTER TABLE "stripe_webhook_events" DROP CONSTRAINT IF EXISTS "stripe_webhook_events_workspace_id_fkey";

-- DropTable
DROP TABLE IF EXISTS "workspace_subscriptions";
DROP TABLE IF EXISTS "workspace_usage_periods";
DROP TABLE IF EXISTS "stripe_webhook_events";
