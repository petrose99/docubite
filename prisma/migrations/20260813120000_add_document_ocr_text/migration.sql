-- Store the local PaddleOCR text extracted from each page. Kept separate from
-- "search_text", which is recomputed from reviewed_data whenever a reviewer edits a
-- field and would otherwise wipe the OCR body; document search now queries both.

ALTER TABLE "documents" ADD COLUMN "ocr_text" TEXT NOT NULL DEFAULT '';
