-- WP13: per-workspace inbound email routing token. Null for every existing workspace — issued
-- lazily on first request, and never for a clinical workspace.
ALTER TABLE "workspaces" ADD COLUMN "inbound_email_token" TEXT;
CREATE UNIQUE INDEX "workspaces_inbound_email_token_key" ON "workspaces"("inbound_email_token");
