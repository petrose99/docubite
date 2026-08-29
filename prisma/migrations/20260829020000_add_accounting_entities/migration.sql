-- WP1.5: chart-of-accounts / vendor / tax-rate sync from QuickBooks/Xero.
CREATE TABLE "accounting_entities" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounting_entities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounting_entities_connection_id_entity_type_external_id_key" ON "accounting_entities"("connection_id", "entity_type", "external_id");
CREATE INDEX "accounting_entities_workspace_id_entity_type_name_idx" ON "accounting_entities"("workspace_id", "entity_type", "name");

ALTER TABLE "accounting_entities" ADD CONSTRAINT "accounting_entities_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounting_entities" ADD CONSTRAINT "accounting_entities_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP POLICY IF EXISTS "accounting_entities_workspace_isolation" ON "accounting_entities";
CREATE POLICY "accounting_entities_workspace_isolation" ON "accounting_entities"
  USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace());
