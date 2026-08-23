-- Phase 2 of the HIPAA remediation: replaces better-auth with Supabase Auth.
--
-- 1. Adds users.supabase_user_id — the link to the Supabase project's auth.users.id (a different
--    Postgres instance/schema than this database). Nullable and populated lazily: a pre-migration
--    row stays unlinked until its first post-migration sign-in (see resolveOrProvisionUser in
--    models/users.ts), not backfilled here, because nothing in this database knows the Supabase
--    identity a given email will map to until that identity is actually created.
--
-- 2. Drops sessions, account, and verification outright — better-auth's own tables. Session and
--    credential state now live entirely in Supabase Auth's project, not here. Run this only after
--    the user-migration script (bulk supabase.auth.admin.createUser + recovery-link email) has
--    completed and the app has been redeployed onto Supabase Auth — dropping these first would
--    break every existing session mid-flight.

ALTER TABLE "users" ADD COLUMN "supabase_user_id" UUID;
CREATE UNIQUE INDEX "users_supabase_user_id_key" ON "users"("supabase_user_id");

DROP TABLE IF EXISTS "sessions";
DROP TABLE IF EXISTS "account";
DROP TABLE IF EXISTS "verification";
