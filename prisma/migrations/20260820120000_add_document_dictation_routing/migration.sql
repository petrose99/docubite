-- Agnostic dictation's routing decision (lib/dictation/pipeline.ts): intent, resolved output
-- format, why it was chosen, the router's confidence score, and any spoken commands. Informational
-- for the verify screen; nothing downstream currently branches on it being present.
ALTER TABLE "documents" ADD COLUMN "dictation_routing" JSONB;
