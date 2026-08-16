-- Extraction panel settings: per-document page range and per-template multi-row export mode
ALTER TABLE "documents" ADD COLUMN "page_range" TEXT;
ALTER TABLE "document_templates" ADD COLUMN "multi_row" BOOLEAN NOT NULL DEFAULT false;
