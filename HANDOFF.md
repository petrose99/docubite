# DocuBite — RAG Document Search: Handoff

_Last updated: 2026-08-18. Branch: `claude/rag-semantic-search-pgvector-c84cc5`._

## 1. What was built

Semantic + keyword search over the **contents** of uploaded documents, surfaced through the existing
**AI Assistant** (no separate search page — that was a deliberate plan decision). Ask the assistant a
question about a document and it retrieves the relevant text and answers with a citation
(`filename, p.N`).

**How it works (two AIs, RAG pattern):**
- **Embeddings — `BAAI/bge-base-en-v1.5` via Hugging Face** turns text into 768-dim vectors to *find*
  relevant chunks.
- **Chat — Google Gemini** decides to search, reads the retrieved chunks, and *writes* the answer.
- Pipeline per upload: **OCR (MinerU) → chunk → embed (BGE) → store (Neon pgvector) → hybrid search
  (vector + Postgres full-text, fused with RRF) → Gemini answers.**
- **No background worker / no AWS.** Embed jobs run in-process on Vercel via the `after()` chain right
  after OCR. The AWS/ECS Terraform in the repo is committed but **unused** by this deployment.

## 2. Current status

| Item | State |
|---|---|
| Code | Committed + pushed. Commits: `91e2312` (feature), `4d4b8c8` (dev cfg), `b74d068` (BGE + model-aware prefixes) |
| Live site | **Deployed & healthy** — https://docubite.vercel.app (HTTP 200), latest deploy `6wm8c019j` |
| Unit tests | **365 passing**, `tsc` clean, lint clean |
| Live pgvector E2E | **6/6** on the user's real invoices with the real BGE model on HF (semantic + keyword) |
| DB migration (Neon prod) | **Applied** (vector extension + `document_chunks` table) via Neon SQL editor |
| Not yet confirmed | The click-through in the **live account** (log in → upload → ask). Config is proven; the in-app run hasn't been watched end to end. |
| Existing documents | **Not backfilled** — only docs uploaded *after* go-live are searchable so far (see §5). |

## 3. Production configuration (Vercel → docubite, Production env)

```
EMBEDDINGS_FORMAT      = huggingface
EMBEDDINGS_BASE_URL    = https://router.huggingface.co/hf-inference
EMBEDDINGS_MODEL_NAME  = BAAI/bge-base-en-v1.5     # 768-dim, free on HF serverless
EMBEDDINGS_API_KEY     = <user's Hugging Face token>   (Sensitive)
GEMINI_API_KEY         = <set>     # the chat assistant
MINERU_API_TOKEN       = <set>     # OCR
DATABASE_URL           = <Neon Postgres>   (Sensitive)
```

## 4. Key decisions & findings (important context)

- **nomic-embed-text is NOT available on Hugging Face's free serverless tier** (`Model not supported by
  provider hf-inference`; no provider mapping). The plan originally assumed nomic. We switched to
  `BAAI/bge-base-en-v1.5` (free, 768-dim). To use nomic specifically you'd need Ollama or a **paid** HF
  TEI Inference Endpoint (`EMBEDDINGS_FORMAT=openai`).
- **Prefixes are model-aware** in `lib/embeddings.ts` (`taskPrefix()`): nomic → `search_document:` /
  `search_query:`; bge → no doc prefix + a query instruction; e5 → `passage:` / `query:`. Using the
  wrong prefixes tanked retrieval (4/6 → 6/6 once corrected).
- **Database is Neon**, not AWS. Prod migrations are applied by hand (Neon SQL editor) — **Vercel does
  not run `prisma migrate deploy`**.
- **Login:** the `prisma/seed.ts` demo accounts (`admin@docubite.local`, etc.) are **local-only** (a
  production guard blocks them). On the live site you must **sign up** a real account.
- **Vercel is Hobby.** The dashboard "Redeploy" is blocked by a git-author permission check; deploy via
  the **CLI as the owner**: `vercel --prod` (already set up + logged in on this machine).
- Multilingual note: BGE-base is English-first but handled the user's FR/DE/PT invoices 6/6. If
  non-English dominates later, `intfloat/multilingual-e5-base` (also 768-dim, free on HF) is the swap.

## 5. What's left to do

1. **Confirm the live flow** (5 min): log in at docubite.vercel.app → upload a document (the 3 demo PDFs
   sent earlier, or real invoices) → wait ~1–2 min → open the ✨ AI Assistant → ask e.g. *"which invoice
   is from a chemistry company?"* → expect an answer with a citation.
2. **Backfill existing documents** so older uploads become searchable. Cleanest for this setup: run this
   in the **Neon SQL editor** (it enqueues embed jobs the app then processes):
   ```sql
   INSERT INTO document_processing_jobs (workspace_id, document_id, type, status, scheduled_at)
   SELECT workspace_id, id, 'embed', 'queued', now()
   FROM documents d
   WHERE d.ocr_text <> ''
     AND NOT EXISTS (SELECT 1 FROM document_chunks c WHERE c.document_id = d.id)
     AND NOT EXISTS (SELECT 1 FROM document_processing_jobs j
                     WHERE j.document_id = d.id AND j.type='embed'
                       AND j.status IN ('queued','processing','completed'));
   ```
   (Only works if queued jobs get drained — new uploads self-process via `after()`; if backfilled jobs
   sit unprocessed, a Vercel Cron hitting `/api/internal/jobs/process` would drain them.)
3. **Optional:** merge the branch to `master` (currently a feature branch), and decide whether to keep or
   drop the unused AWS Terraform edits.

## 6. Operational gotchas

- **Deploy:** `cd` to the worktree, `vercel --prod --yes`. It ships the working tree (not git) as owner.
- **Local dev:** `prisma dev` (PGlite) DB — **has no pgvector**, so RAG is disabled locally by design.
  Start order: `prisma dev` (reuses port 51218) → `npm run dev` (port 7331). Demo accounts work locally.
- **Full-fidelity local test** (what proved 6/6): docker `pgvector/pgvector:pg17` on :5433 + real HF via
  a token-in-a-local-file (never in chat) + `scripts/e2e-invoices.ts` (temporary, deleted). Migrations
  now apply cleanly to a fresh DB.
- **Graceful degradation:** if HF is down, keyword search still works and Gemini still answers — the
  assistant's tool returns `document_search_unavailable` rather than crashing the chat.

## 7. Key files

- `lib/embeddings.ts` — HF/OpenAI client, model-aware prefixes, retry/dims validation
- `lib/chunking.ts` — chunker (blocks sidecar + ocrText fallback, versioned content hash)
- `models/document-chunks.ts` — raw SQL: pgvector + FTS (workspace-scoped)
- `lib/retrieval.ts` — RRF fusion + hybrid search
- `lib/document-embedding.ts` — the embed job handler (never touches document.status)
- `lib/document-processing.ts` — job dispatch by type + embed enqueue/chaining
- `app/api/ai-chat/route.ts` — server-executed `search_documents` tool + Gemini
- `components/assistant/{assistant-panel,sheet-tools}.tsx` — client onToolCall guard
- `prisma/schema.prisma` + `prisma/migrations/20260818120000_add_document_chunks/` — schema/migration
- `scripts/backfill-embeddings.ts` — backfill (needs DB access)
- `.env.example` — full config reference incl. the nomic-vs-bge note
