-- Remove 24-hour source retention and inbound email ingestion (Document Inbox
-- becomes upload-only; sources and reviewed data are retained indefinitely).
-- Dropping a column also drops any constraint or index defined solely on it.

-- Drop inbound email ingestion entirely.
DROP TABLE "inbound_messages";

ALTER TABLE "workspaces" DROP COLUMN "inbox_token";
ALTER TABLE "workspaces" DROP COLUMN "inbox_address";

-- Drop retention bookkeeping and the sender hash (email-only field) from documents.
ALTER TABLE "documents" DROP COLUMN "source_expires_at";
ALTER TABLE "documents" DROP COLUMN "source_deleted_at";
ALTER TABLE "documents" DROP COLUMN "sender_hash";
