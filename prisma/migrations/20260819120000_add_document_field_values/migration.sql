-- The structured spine: one row per extracted value, projected out of the JSON blob that lives in
-- documents.reviewed_data. That blob is fine for rendering one document and useless for asking
-- questions across many — you cannot index into it, range-filter it, or count it. This table is the
-- queryable projection of the same facts, driven by the template field DSL, so it covers every
-- current and future template without a per-domain schema.
--
-- Scalars are one row with item_key/row_index NULL. An array field (line items, IHC markers) is one
-- row per item field per row of the array, carrying its row_index, so a line-item SKU is filterable
-- in exactly the same way a top-level vendor is.

CREATE TABLE "document_field_values" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "document_id" UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "file_id" UUID NOT NULL REFERENCES "document_files"("id") ON DELETE CASCADE,
  -- The worksheet code the value was extracted under ("invoice", "pathology_report"). Denormalised
  -- so a domain-scoped query needs no join back to documents/templates.
  "template_code" TEXT,
  "field_key" TEXT NOT NULL,
  -- Set only for array fields: field_key is the array ("line_items"), item_key the field within one
  -- row ("sku"), row_index its position. All three NULL-free together or item_key/row_index NULL.
  "item_key" TEXT,
  "row_index" INTEGER,
  -- Exactly one of the four value columns is non-null, chosen by the field's declared type. The
  -- typed columns are what make range and equality filters actual index scans rather than JSON casts.
  "value_text" TEXT,
  "value_number" DOUBLE PRECISION,
  "value_date" DATE,
  "value_bool" BOOLEAN,
  -- Where this fact came from: vlm_ocr | asr | llm_structured | manual. Every stored fact carries
  -- its origin so a citation can say how it was obtained, not just where.
  "source" TEXT NOT NULL DEFAULT 'llm_structured',
  "source_confidence" DOUBLE PRECISION,
  -- The same Ref shape lib/provenance resolves ({page, bbox, quote, blockIndex, score}), copied
  -- here so a filtered hit can be cited without re-reading the document's provenance blob.
  "provenance" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Case- and whitespace-insensitive matching for text equality ("ACME Ltd " = "acme ltd"), generated
-- and STORED so it can never drift from value_text. Not declared in schema.prisma, which cannot
-- express a generated column — the same split already used for document_chunks.text_tsv.
ALTER TABLE "document_field_values" ADD COLUMN "value_text_norm" TEXT
  GENERATED ALWAYS AS (lower(btrim("value_text"))) STORED;

-- One index per value type, all workspace-first: every query is scoped to one workspace before it
-- filters, so the leading column keeps a workspace's scan off every other workspace's rows.
CREATE INDEX "document_field_values_text_idx" ON "document_field_values"("workspace_id", "field_key", "value_text_norm");
CREATE INDEX "document_field_values_number_idx" ON "document_field_values"("workspace_id", "field_key", "value_number");
CREATE INDEX "document_field_values_date_idx" ON "document_field_values"("workspace_id", "field_key", "value_date");
-- Serves the re-projection delete and the "everything known about this document" read.
-- Named the way Prisma names @@index([workspaceId, documentId]), since that one IS declared in
-- schema.prisma; the three above are not, because they lead with the generated column or exist
-- purely for the raw-SQL filter paths.
CREATE INDEX "document_field_values_workspace_id_document_id_idx" ON "document_field_values"("workspace_id", "document_id");
