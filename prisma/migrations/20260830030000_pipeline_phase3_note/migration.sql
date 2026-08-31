-- Pipeline redesign Phase 3: the split-pane detail view's Note tab. Free-text, separate from
-- reviewedData/codingData — a reviewer's own remark, not a value read off (or coded onto) the
-- document. Additive-only.
ALTER TABLE "documents" ADD COLUMN "note" TEXT;
