-- Dynamic field naming for dictation: the extraction model can propose a field the current
-- template has no slot for, but only a human approving it turns that proposal into a real column
-- (see lib/field-suggestions.ts and models/field-suggestions.ts). This table is the pending queue.

CREATE TABLE "field_suggestions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "template_id" UUID,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "decided_by_id" UUID,

    CONSTRAINT "field_suggestions_pkey" PRIMARY KEY ("id")
);

-- An approved/dismissed pair for the same key on the same document would be two different answers
-- to "did we add this field" that both claim to be final — the decision is made once.
CREATE UNIQUE INDEX "field_suggestions_document_id_key_key" ON "field_suggestions" ("document_id", "key");
CREATE INDEX "field_suggestions_workspace_id_idx" ON "field_suggestions" ("workspace_id");
CREATE INDEX "field_suggestions_document_id_status_idx" ON "field_suggestions" ("document_id", "status");

ALTER TABLE "field_suggestions" ADD CONSTRAINT "field_suggestions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "field_suggestions" ADD CONSTRAINT "field_suggestions_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "field_suggestions" ADD CONSTRAINT "field_suggestions_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "document_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "field_suggestions" ADD CONSTRAINT "field_suggestions_decided_by_id_fkey"
  FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A decision is attributable by definition: a decider without a timestamp, or a timestamp without
-- a decider, would be a half-recorded audit trail. Mirrors documents_transcript_edit_attributable.
ALTER TABLE "field_suggestions" ADD CONSTRAINT "field_suggestions_decision_attributable"
  CHECK (("decided_at" IS NULL) = ("decided_by_id" IS NULL));
