-- Dictation ingestion + report drafting.
--
-- A dictation is NOT a new entity: it is a Document whose mime type is audio. That inheritance is
-- the whole design — storage, the job queue, chunking, embedding, field values, audit, sharing and
-- quota all already work on Documents, so the transcript landing in `ocr_text` makes dictations
-- searchable through the existing hybrid retrieval with no new retrieval code at all.

-- The timestamped transcript: [{startMs, endMs, text}]. Kept alongside ocr_text (which holds the
-- flat text the rest of the pipeline reads) because the timestamps are what audio provenance pins
-- values to, and because the raw transcript must be retained verbatim next to anything derived
-- from it.
ALTER TABLE "documents" ADD COLUMN "transcript" JSONB;
-- Which ASR model produced it, so a re-transcription with a different model is distinguishable.
ALTER TABLE "documents" ADD COLUMN "transcript_model" TEXT;

-- A report template per specimen type. Workspace-scoped and seeded per institution rather than
-- hard-coded: synoptic reporting formats are set by the lab and the protocol it follows (CAP,
-- ICCR, or a local variant), and baking one in would make the feature wrong everywhere else.
CREATE TABLE "report_templates" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  -- The specimen this template applies to, matched against the document's specimen_type value.
  -- Null is the workspace's fallback template.
  "specimen_type" TEXT,
  -- Ordered synoptic slots: [{key, label, required}]. Rendering walks these, never the values, so
  -- a field the template does not list cannot appear in a report.
  "synoptic_fields" JSONB NOT NULL,
  -- Ordered narrative sections: [{key, title, instruction}].
  "narrative_sections" JSONB NOT NULL,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("workspace_id", "name")
);
CREATE INDEX "report_templates_workspace_id_specimen_type_idx" ON "report_templates"("workspace_id", "specimen_type");

-- One drafted report for one document.
--
-- `status` is the clinical safety boundary. A draft is created 'draft' and there is no code path
-- that writes 'signed' except the explicit sign-off action; nothing auto-finalises and nothing
-- auto-files. The CHECK constraint makes that a database guarantee rather than a convention, and
-- the paired constraint below makes a signed row without a signer impossible to write.
CREATE TABLE "document_report_drafts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "document_id" UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "template_id" UUID REFERENCES "report_templates"("id") ON DELETE SET NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  -- The deterministic half: {slotKey: value|null}, filled by template slotting with no LLM.
  "synoptic" JSONB NOT NULL,
  -- The generated half: {sectionKey: text}.
  "narrative" JSONB NOT NULL,
  "rendered_text" TEXT NOT NULL,
  -- Required slots with no dictated value, surfaced as the pre-sign-off checklist.
  "missing_fields" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "signed_by_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "signed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_report_drafts_status_check" CHECK ("status" IN ('draft', 'signed')),
  -- Signed implies a signer and a time; draft implies neither. Enforced here so no future code
  -- path, however well-intentioned, can produce a report that claims to be signed by nobody.
  CONSTRAINT "document_report_drafts_signed_check" CHECK (
    ("status" = 'draft'  AND "signed_by_id" IS NULL AND "signed_at" IS NULL) OR
    ("status" = 'signed' AND "signed_by_id" IS NOT NULL AND "signed_at" IS NOT NULL)
  )
);
CREATE INDEX "document_report_drafts_workspace_id_document_id_idx" ON "document_report_drafts"("workspace_id", "document_id");
CREATE UNIQUE INDEX "document_report_drafts_document_id_version_key" ON "document_report_drafts"("document_id", "version");
