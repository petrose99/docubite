-- Semantic + lexical document search (RAG): one row per embedded slice of a document's OCR text.
-- The table itself is plain and portable; the two search columns (a pgvector embedding and a
-- generated tsvector) are added further down because they need capabilities the local PGlite dev
-- database does not have. Where pgvector is absent the table is created without the embedding
-- column and the feature stays dark — it is env-gated off there anyway (EMBEDDINGS_BASE_URL unset).

-- pgvector ships with RDS Postgres but not with PGlite. Guarded so a dev `migrate deploy` does not
-- abort on it: on PGlite the CREATE EXTENSION raises, we swallow it, and continue without vectors.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector unavailable (%): document_chunks created without vector search', SQLERRM;
END $$;

CREATE TABLE "document_chunks" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "document_id" UUID NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "file_id" UUID NOT NULL REFERENCES "document_files"("id") ON DELETE CASCADE,
  "chunk_index" INTEGER NOT NULL, "text" TEXT NOT NULL, "provenance" JSONB, "content_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("document_id", "chunk_index")
);
CREATE INDEX "document_chunks_workspace_id_idx" ON "document_chunks"("workspace_id");

-- Lexical half of hybrid retrieval. 'simple' (not 'english') on purpose: invoice numbers, IBANs
-- and amounts have to match verbatim, and a stemming/stop-word config would mangle them. Generated
-- and STORED so it is always in sync with `text`; not declared in schema.prisma, which cannot
-- express a generated tsvector column.
ALTER TABLE "document_chunks" ADD COLUMN "text_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', "text")) STORED;
CREATE INDEX "document_chunks_text_tsv_idx" ON "document_chunks" USING GIN ("text_tsv");

-- Vector half: only where pgvector actually loaded above. The 768-dim column and its HNSW cosine
-- index are added inside a guard on pg_extension, so this whole block is a no-op on PGlite dev.
-- 768 is nomic-embed-text's dimensionality; a model of any other size fails the embed job with
-- embedding_dims_mismatch rather than being stored here.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    ALTER TABLE "document_chunks" ADD COLUMN "embedding" vector(768);
    CREATE INDEX "document_chunks_embedding_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);
  END IF;
END $$;
