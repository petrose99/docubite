-- Generalizes Workspace.productMode ("accounting" | "clinical") into Workspace.industry
-- ("finance" | "healthcare" | "construction" | "logistics" | "general").
--
-- Backfill: clinical -> healthcare; accounting with a live integration connection -> finance
-- (never silently revoke a workspace mid QBO/Xero push); every other accounting -> general.
ALTER TABLE "workspaces" RENAME COLUMN "product_mode" TO "industry";
ALTER TABLE "workspaces" ALTER COLUMN "industry" SET DEFAULT 'general';

UPDATE "workspaces" SET "industry" = 'healthcare' WHERE "industry" = 'clinical';

UPDATE "workspaces" SET "industry" = CASE
  WHEN id IN (SELECT DISTINCT workspace_id FROM integration_connections) THEN 'finance'
  ELSE 'general'
END
WHERE "industry" = 'accounting';
