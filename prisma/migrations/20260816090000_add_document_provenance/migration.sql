-- Where each extracted value came from in the source document: a per-field {page, bbox, quote}
-- record the viewer uses to scroll and highlight the spot the value was read from.
--
-- Purely additive: one nullable JSONB column. Documents extracted before this migration simply
-- carry no provenance, and every read path treats a null column as "no source pin available".
ALTER TABLE "documents" ADD COLUMN "provenance" JSONB;
