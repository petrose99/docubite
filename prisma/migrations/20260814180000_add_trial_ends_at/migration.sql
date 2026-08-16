-- Free-trial clock for a workspace. Nullable: rows that predate trials have none to expire, and
-- a workspace on a paid Stripe subscription is governed by current_period_end instead.
ALTER TABLE "workspace_subscriptions" ADD COLUMN "trial_ends_at" TIMESTAMP(3);
