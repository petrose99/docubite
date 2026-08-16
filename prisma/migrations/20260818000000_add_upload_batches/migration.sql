-- Folder reasoning: a grouping key stamped on every document uploaded together in one drag, so a
-- folder of documents can be reported on as a set (grouped, deduped, gap-checked) rather than as
-- N unrelated uploads. A batch is just an id shared across the run — no new table.
--
-- Purely additive: one nullable column and an index. Documents uploaded before this simply have no
-- batch, and the report is only ever built for a batch that exists.
ALTER TABLE "documents" ADD COLUMN "upload_batch_id" UUID;
CREATE INDEX "documents_file_id_upload_batch_id_idx" ON "documents"("file_id", "upload_batch_id");
