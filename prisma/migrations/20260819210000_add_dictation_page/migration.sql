-- Dictation gets its own page: a container file to hold recordings, and an honest record of
-- transcript edits.

-- 1. document_files.kind
--
-- A Document needs a fileId and a templateId, so dictations need a file to belong to. That file is
-- app-managed furniture seeded with the pathology worksheet rather than something anyone opens as
-- a spreadsheet, so it is tagged and hidden from the Files browser.
ALTER TABLE "document_files" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'sheet';

-- One dictation container per workspace, enforced by the database rather than by ensureDictationFile
-- remembering to check. Partial, so ordinary sheets are unaffected — a workspace may have any
-- number of those.
CREATE UNIQUE INDEX "document_files_workspace_id_dictation_key"
  ON "document_files" ("workspace_id") WHERE "kind" = 'dictation';

CREATE INDEX "document_files_workspace_id_kind_idx" ON "document_files" ("workspace_id", "kind");

-- 2. documents.transcript_edited_*
--
-- The verify screen lets a pathologist correct a mis-transcribed word. That is the right call —
-- re-dictating a whole case over one misheard term is worse — but it means the stored transcript is
-- no longer purely what the microphone heard. Stamped so the UI can say so, and so a report drawn
-- from an edited transcript is never mistaken for an unedited ASR pass.
ALTER TABLE "documents" ADD COLUMN "transcript_edited_at" TIMESTAMP(3);
ALTER TABLE "documents" ADD COLUMN "transcript_edited_by_id" UUID;

ALTER TABLE "documents" ADD CONSTRAINT "documents_transcript_edited_by_id_fkey"
  FOREIGN KEY ("transcript_edited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- An edit is attributable by definition: an editor without a timestamp, or a timestamp without an
-- editor, would be a half-recorded provenance claim. Mirrors the signed-requires-signer CHECK on
-- document_report_drafts.
ALTER TABLE "documents" ADD CONSTRAINT "documents_transcript_edit_attributable"
  CHECK (("transcript_edited_at" IS NULL) = ("transcript_edited_by_id" IS NULL));
