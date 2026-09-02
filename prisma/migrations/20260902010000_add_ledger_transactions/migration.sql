-- Data Health Phase B: bill/expense/bank-transaction rows synced from an IntegrationConnection's
-- provider (lib/health/sync.ts's syncLedgerTransactions), read by the cleanup-category health
-- checks. Mirrors accounting_entities' shape exactly (same soft-retire-via-active convention, same
-- per-connection unique key, same RLS policy style).
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "contact_external_id" TEXT,
    "contact_name" TEXT,
    "account_external_id" TEXT,
    "account_name" TEXT,
    "doc_number" TEXT,
    "amount" DOUBLE PRECISION,
    "tax_amount" DOUBLE PRECISION,
    "currency_code" TEXT,
    "txn_date" DATE,
    "reconciled" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ledger_transactions_connection_id_kind_external_id_key" ON "ledger_transactions"("connection_id", "kind", "external_id");
CREATE INDEX "ledger_transactions_workspace_id_kind_txn_date_idx" ON "ledger_transactions"("workspace_id", "kind", "txn_date");
CREATE INDEX "ledger_transactions_workspace_id_contact_external_id_idx" ON "ledger_transactions"("workspace_id", "contact_external_id");

ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP POLICY IF EXISTS "ledger_transactions_workspace_isolation" ON "ledger_transactions";
CREATE POLICY "ledger_transactions_workspace_isolation" ON "ledger_transactions"
  USING ("workspace_id" = app_current_workspace()) WITH CHECK ("workspace_id" = app_current_workspace());
