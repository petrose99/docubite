-- Creates a least-privilege, non-superuser role for the application's own database connection.
--
-- Not a Prisma migration: a migration file is committed to git history forever, and this file
-- sets a password. Run manually against the RDS instance (as the master user) once, generate the
-- password with something like `openssl rand -base64 32`, and store it in Secrets Manager next to
-- the app's other secrets (infra/aws/terraform/main.tf already wires DATABASE_URL from there).
--
-- Why this matters even with FORCE ROW LEVEL SECURITY already set (20260822010000): FORCE binds
-- the RDS master user because AWS withholds the actual SUPERUSER attribute from it, but tenant
-- isolation should not rest entirely on that fact staying true. A connection through a role that
-- provably cannot bypass RLS — NOSUPERUSER, and not the table owner — is the guarantee that holds
-- regardless of how RDS is configured.
--
-- BYPASSRLS defaults to false on CREATE ROLE; it is named explicitly below so the intent survives
-- a read of this file rather than depending on the default.

CREATE ROLE docubite_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '<set via Secrets Manager, do not commit>';

GRANT CONNECT ON DATABASE postgres TO docubite_app;
GRANT USAGE ON SCHEMA public TO docubite_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO docubite_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO docubite_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO docubite_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO docubite_app;

-- After this role exists and DATABASE_URL is repointed at it, table ownership itself should also
-- move off the master user (REASSIGN OWNED BY <master> TO docubite_app) so ENABLE/FORCE ROW LEVEL
-- SECURITY governs the role the app actually connects as, not just the role it happens to share
-- object ownership with today.
