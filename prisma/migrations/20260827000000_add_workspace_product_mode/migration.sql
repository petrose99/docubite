-- Foundation phase 1 (WP2): product mode splits the single app into two positioned modes —
-- "accounting" (the default, and the new primary buyer) and "clinical" (the original
-- dictation-first positioning). Existing hipaaMode workspaces are backfilled to "clinical":
-- hipaaMode was the only signal of clinical intent before this column existed, and every
-- hipaaMode workspace today is a clinical one. New workspaces default to "accounting".
ALTER TABLE "workspaces" ADD COLUMN "product_mode" TEXT NOT NULL DEFAULT 'accounting';

UPDATE "workspaces" SET "product_mode" = 'clinical' WHERE "hipaa_mode" = true;
