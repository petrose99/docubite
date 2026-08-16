-- The platform admin console: account suspension, and an audit log of what an admin did.
--
-- Purely additive on purpose, like 20260815000000_add_spreadsheet_workbook. Nothing here alters,
-- renames, retypes or drops an existing column, so it can be applied to a live database without
-- disturbing anything the app is currently serving — and it applies cleanly to an empty one,
-- which is the path `npm start` (prisma migrate deploy) takes on a new environment.

-- Suspension is its own nullable timestamp rather than a role of "suspended". A role would
-- destroy the prior role (a suspended admin could not be restored), and it would silently revoke
-- plan-limit exemption from every workspace that admin owns — a moderation action with a billing
-- side effect. It would also enforce nothing: every `role !== "admin"` check in the codebase
-- passes just as happily for "suspended". Enforcement is one check in getApiUser (lib/auth.ts).
ALTER TABLE "users" ADD COLUMN "suspended_at" TIMESTAMP(3);

-- A separate table from document_audit_events, not an extension of it. That table's workspace_id
-- is NOT NULL with ON DELETE CASCADE, so the row recording "an admin deleted workspace X" would
-- be deleted along with workspace X — precisely the record that must survive. Making its column
-- nullable and recreating its foreign key is exactly the destructive DDL this migration avoids;
-- a CREATE TABLE costs less in real risk.
--
-- target_user_id and target_workspace_id are deliberately plain uuids with NO foreign key: the
-- audit row has to outlive the thing it describes.
CREATE TABLE "admin_audit_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "type" TEXT NOT NULL,
    "target_user_id" UUID,
    "target_workspace_id" UUID,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_events_created_at_idx" ON "admin_audit_events"("created_at");
CREATE INDEX "admin_audit_events_actor_id_created_at_idx" ON "admin_audit_events"("actor_id", "created_at");

-- SET NULL, not CASCADE: deleting the admin who took an action must not delete the record of it.
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
