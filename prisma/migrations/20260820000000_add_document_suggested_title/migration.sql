-- Model's proposed title for a discover-mode dictation (lib/field-suggestions.ts), offered as a
-- one-click fill on the verify screen. Never applied automatically.
ALTER TABLE "documents" ADD COLUMN "suggested_title" TEXT;
