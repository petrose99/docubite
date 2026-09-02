-- Materialized folder path on document_files for fast folder-tree queries
ALTER TABLE "document_files"
  ADD COLUMN "folder_path" TEXT;

-- Parent document for split children
ALTER TABLE "documents"
  ADD COLUMN "parent_document_id" UUID,
  ADD COLUMN "split_status" TEXT;

-- Index for finding children of a parent document
CREATE INDEX "documents_parent_document_id_idx" ON "documents" ("parent_document_id");

-- Index for folder path prefix queries
CREATE INDEX "document_files_folder_path_idx" ON "document_files" ("workspace_id", "folder_path");

-- FK from child to parent document
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_parent_document_id_fkey"
  FOREIGN KEY ("parent_document_id") REFERENCES "documents" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS policy for folder_path (inherits from existing document_files policies)
-- RLS policy for parent_document_id (inherits from existing documents policies)
