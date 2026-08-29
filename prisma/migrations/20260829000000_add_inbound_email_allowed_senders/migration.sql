-- WP1.4: widen the inbound-email sender allowlist beyond "already a workspace member".
CREATE TABLE "inbound_email_allowed_senders" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "pattern" TEXT NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "inbound_email_allowed_senders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inbound_email_allowed_senders_workspace_id_pattern_key" ON "inbound_email_allowed_senders"("workspace_id", "pattern");

ALTER TABLE "inbound_email_allowed_senders" ADD CONSTRAINT "inbound_email_allowed_senders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inbound_email_allowed_senders" ADD CONSTRAINT "inbound_email_allowed_senders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP POLICY IF EXISTS "inbound_email_allowed_senders_workspace_isolation" ON "inbound_email_allowed_senders";
CREATE POLICY "inbound_email_allowed_senders_workspace_isolation" ON "inbound_email_allowed_senders"
  USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace());
