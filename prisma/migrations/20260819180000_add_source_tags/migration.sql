-- Source tagging on chunks, completing the "every stored fact knows how it was obtained" property
-- that document_field_values already has.
--
-- Why chunks need it too: a retrieved snippet is evidence the assistant cites, and a snippet from a
-- dictation is a materially different claim from one lifted off a printed invoice. Speech
-- recognition mishears words; OCR misreads glyphs (see the v6-tiny 0-as-o failure); a hand-typed
-- correction is neither. The citation should be able to say which.
--
-- Backfilled from the document's own source rather than defaulted blindly: existing chunks came
-- from MinerU-parsed documents, so vlm_ocr is the truthful value for them.

ALTER TABLE "document_chunks" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'vlm_ocr';
ALTER TABLE "document_chunks" ADD COLUMN "source_confidence" DOUBLE PRECISION;

UPDATE "document_chunks" c
   SET "source" = 'asr'
  FROM "documents" d
 WHERE d."id" = c."document_id" AND d."source" = 'dictation';

-- Retrieval is a disclosure event: it returns document contents to whoever asked. Auditing it is
-- what makes "who looked at what, and when" answerable. DocumentAuditEvent.type is a free String
-- (the set grows by data, not by migration), so the new document_searched / report_signed types
-- need no enum change — only an index that makes the query-history question cheap to ask.
CREATE INDEX IF NOT EXISTS "document_audit_events_workspace_id_type_created_at_idx"
  ON "document_audit_events"("workspace_id", "type", "created_at");
