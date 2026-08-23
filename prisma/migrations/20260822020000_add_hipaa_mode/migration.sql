-- F15: a per-workspace flag that locks out unauthenticated link sharing for workspaces presumed
-- to handle ePHI. See models/files.ts (setLinkAccess, getFileAccess) for enforcement.

ALTER TABLE "workspaces" ADD COLUMN "hipaa_mode" BOOLEAN NOT NULL DEFAULT false;
