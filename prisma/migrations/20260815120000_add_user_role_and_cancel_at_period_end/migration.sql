-- Platform role. "user" or "admin"; an admin owner makes their workspaces exempt from every plan
-- limit (see isWorkspaceLimitExempt in models/workspaces.ts). NOT NULL with a default so every
-- existing row becomes an ordinary user without a backfill pass.
ALTER TABLE "users" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';

-- Set from customer.subscription.* when the customer cancels in the Stripe portal: the
-- subscription stays active until current_period_end and then stops.
ALTER TABLE "workspace_subscriptions" ADD COLUMN "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false;
