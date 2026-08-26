-- F16: register of third parties that can receive customer document content or metadata, with
-- BAA status. Seeded with every processor the codebase actually calls, derived from the wiring in
-- ai/providers/, lib/mineru.ts, lib/embeddings.ts, lib/rerank.ts, lib/asr/, sentry.*.config.ts,
-- lib/email.ts, and infra/aws/terraform — not a guess. ON CONFLICT (name) DO NOTHING makes the
-- seed idempotent and, more importantly, non-destructive: if someone has already updated a row's
-- baa_status through the admin console before this migration re-runs (e.g. a reseeded database),
-- their edit is not silently overwritten by these placeholder values.

CREATE TABLE "subprocessors" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL UNIQUE,
  "purpose" TEXT NOT NULL,
  "data_received" TEXT NOT NULL,
  "baa_status" TEXT NOT NULL DEFAULT 'not_started',
  "region" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- DEFAULT here (unlike Prisma's usual @updatedAt-only columns) only because this migration
  -- seeds rows below via raw SQL rather than through Prisma, which is what normally stamps this
  -- column on every write.
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "subprocessors" ("id", "name", "purpose", "data_received", "baa_status", "region", "notes") VALUES
  (gen_random_uuid(), 'AWS', 'Cloud infrastructure: S3 document storage, RDS database, Fargate workers, KMS encryption', 'All stored document content and extracted data', 'in_progress', 'eu-west-1', 'BAA is self-serve via AWS Artifact; record the execution date here once signed.'),
  (gen_random_uuid(), 'Vercel', 'Application hosting: Next.js compute, server actions, API routes', 'Document content in transit through server actions and API routes', 'not_started', NULL, 'HIPAA BAA available as a self-serve Pro add-on; Enterprise required for Secure Compute (VPC peering).'),
  (gen_random_uuid(), 'OpenAI', 'AI extraction: OCR text and page images sent for structured field extraction', 'Document OCR text and rendered page images', 'not_started', NULL, 'Only reached when AI_PROVIDER=openai.'),
  (gen_random_uuid(), 'Google (Gemini)', 'AI extraction and the AI Assistant: document content and chat queries', 'Document OCR text, rendered page images, and user chat queries', 'not_started', NULL, 'The AI Assistant (app/api/ai-chat) is Gemini-only regardless of AI_PROVIDER.'),
  (gen_random_uuid(), 'MinerU', 'Third-party OCR: parses uploaded documents into structured text/blocks before extraction', 'The entire raw uploaded document file', 'not_started', NULL, 'Runs before the extraction pipeline; verify their data retention policy.'),
  (gen_random_uuid(), 'Embeddings provider', 'Document search: generates vector embeddings of chunked document text', 'Chunked document text', 'not_started', NULL, 'Endpoint configured via EMBEDDINGS_BASE_URL; defaults to a Hugging Face serverless endpoint.'),
  (gen_random_uuid(), 'Reranker', 'Document search: reranks retrieved passages by relevance', 'Chunked document text and the search query', 'not_started', NULL, 'Endpoint configured via RERANK_BASE_URL; optional feature.'),
  (gen_random_uuid(), 'ASR backend', 'Speech-to-text transcription for dictation', 'Raw audio recordings', 'not_started', NULL, 'Deepgram or Hugging Face depending on ASR_BACKEND.'),
  (gen_random_uuid(), 'Sentry', 'Error monitoring and performance tracing', 'Error stack traces and request metadata', 'not_started', NULL, 'PHI scrubbing (beforeSend) added — verify no document content reaches breadcrumbs before treating this as low-risk.'),
  (gen_random_uuid(), 'Resend', 'Transactional email: workspace invitations and password reset links', 'Recipient email addresses and invitation/reset link content', 'not_applicable', NULL, 'No document content is ever sent.'),
  (gen_random_uuid(), 'Stripe', 'Billing and subscription management', 'Billing contact info and payment metadata only', 'not_applicable', NULL, 'No document content reaches Stripe.')
ON CONFLICT ("name") DO NOTHING;
