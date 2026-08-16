-- Introduces the file layer: every workspace gains a Files list, and worksheets and documents
-- hang off a file rather than off the workspace directly.
--
-- Order matters. The columns are added nullable and backfilled first, because the two unique
-- constraints being swapped ((workspace_id, code) -> (file_id, code) and
-- (workspace_id, sha256) -> (file_id, sha256)) can only hold once every row has a file.
-- Backfilling into exactly one file per workspace preserves the old pairs' uniqueness.

ALTER TABLE "workspaces" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'personal';

CREATE TABLE "document_folders" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "document_folders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_files" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "folder_id" UUID,
    "name" TEXT NOT NULL DEFAULT 'untitled',
    "created_by_id" UUID,
    "link_access" TEXT NOT NULL DEFAULT 'none',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "document_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_file_shares" (
    "id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "user_id" UUID,
    "email" TEXT NOT NULL,
    "access" TEXT NOT NULL DEFAULT 'view',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "document_file_shares_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "document_folders_workspace_id_parent_id_idx" ON "document_folders"("workspace_id", "parent_id");
CREATE INDEX "document_files_workspace_id_folder_id_idx" ON "document_files"("workspace_id", "folder_id");
CREATE INDEX "document_files_workspace_id_updated_at_idx" ON "document_files"("workspace_id", "updated_at");
CREATE INDEX "document_file_shares_email_idx" ON "document_file_shares"("email");
CREATE UNIQUE INDEX "document_file_shares_file_id_email_key" ON "document_file_shares"("file_id", "email");

ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "document_folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "document_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "document_files" ADD CONSTRAINT "document_files_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "document_file_shares" ADD CONSTRAINT "document_file_shares_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "document_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_file_shares" ADD CONSTRAINT "document_file_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "document_templates" ADD COLUMN "file_id" UUID;
ALTER TABLE "documents" ADD COLUMN "file_id" UUID;

-- One "untitled" file per existing workspace, credited to that workspace's owner.
INSERT INTO "document_files" ("id", "workspace_id", "name", "created_by_id", "created_at", "updated_at")
SELECT gen_random_uuid(), w."id", 'untitled',
       (SELECT m."user_id" FROM "workspace_members" m WHERE m."workspace_id" = w."id" AND m."role" = 'owner' ORDER BY m."created_at" ASC LIMIT 1),
       w."created_at", CURRENT_TIMESTAMP
FROM "workspaces" w;

UPDATE "document_templates" t
SET "file_id" = f."id"
FROM "document_files" f
WHERE f."workspace_id" = t."workspace_id";

UPDATE "documents" d
SET "file_id" = f."id"
FROM "document_files" f
WHERE f."workspace_id" = d."workspace_id";

ALTER TABLE "document_templates" ALTER COLUMN "file_id" SET NOT NULL;
ALTER TABLE "documents" ALTER COLUMN "file_id" SET NOT NULL;

ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "document_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "document_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "document_templates_workspace_id_code_key";
DROP INDEX "documents_workspace_id_sha256_key";
CREATE UNIQUE INDEX "document_templates_file_id_code_key" ON "document_templates"("file_id", "code");
CREATE UNIQUE INDEX "documents_file_id_sha256_key" ON "documents"("file_id", "sha256");
CREATE INDEX "document_templates_workspace_id_idx" ON "document_templates"("workspace_id");
CREATE INDEX "documents_file_id_received_at_idx" ON "documents"("file_id", "received_at");
