# DocuBite — Structured Retrieval, Multi-Domain Adapters, Dictation & Isolation: Handoff

_Last updated: 2026-08-19. Companion to `HANDOFF.md` (the original RAG work), which remains accurate._

Four stages, built and verified against a real database and a real browser session. **Nothing here is
enabled by default that was not already on** — every new behaviour is behind a flag or an env var, so
deploying this changes nothing until it is switched on.

---

## 0. The audit that came first

The brief's "Current State" was wrong in four material ways. Corrected before any code was written:

| Brief claimed | Reality |
|---|---|
| "A VLM extracts text from images" | Hosted **MinerU cloud** returns markdown + bboxes. The field-extraction LLM never sees page images. No local VLM. |
| "Querying is pure vector RAG" | **Already hybrid** — `rrfFuse(k=60)` over pgvector cosine + Postgres `tsvector`, 24 candidates per half. |
| "No per-domain schema adapters" | The Zod field DSL in `lib/document-templates.ts` already was one. Adding a domain is data. |
| "No audio capability" | Correct — that part was genuinely missing. |

Roughly half the brief was already built. The stages below built only what was actually missing.

---

## 1. Stage 1 — Structured spine + domain packs

**Problem:** extracted values lived only in `Document.reviewedData` JSON. No exact filtering, no
completeness. "How many invoices from X?" was unanswerable.

**Built**
- `document_field_values` — one row per extracted value, typed columns (`value_text` / `value_number` /
  `value_date` / `value_bool`), generated `value_text_norm` for case/whitespace-insensitive matching,
  `source` + `source_confidence` + `provenance`. Array fields expand to one row per item field per row,
  carrying `row_index`.
- `lib/field-projection.ts` — pure, DB-free `projectDocumentFields`.
- `models/document-field-values.ts` — parameterised SQL builders, a filter language compiling to
  correlated `EXISTS`, and `findDocumentsByFields` with **no top-k**.
- `lib/domains/` — `finance` (the existing three templates, moved verbatim), `pathology`, `logistics`,
  plus a registry carrying each domain's ASR `biasTerms`.
- `scripts/backfill-field-values.ts` — idempotent.

**Verified** — 16 filter checks against the real DB, each cross-checked against an independent
`reviewedData` JSON scan: exact equality, case/whitespace folding, numeric and date ranges, array-row
fields, `neq`, `exists`, `contains`, scalar/array non-interference, cross-workspace isolation. All
matched. Re-running the backfill stayed at the same row count.

> **Deliberate deviation:** pathology and logistics are registered but **not** in
> `DEFAULT_DOCUMENT_TEMPLATES`, because everything in that array is seeded as a worksheet into every
> new file (`models/files.ts`). They are opt-in.

---

## 2. Stage 2 — Pre-filters, query router, reranker seam, eval harness

**Built**
- Structured pre-filters compiled **into** both channel queries' `WHERE` (not post-filtering), so a
  selective constraint narrows the index scan.
- `lib/query-router.ts` — splits a query into filters + semantic remainder, using a schema built from
  the workspace's *actually populated* field keys. **Every** failure path returns the raw query and no
  filters, i.e. exactly today's behaviour.
- `find_documents` assistant tool — the completeness channel.
- `lib/rerank.ts` — identity by default, gated on `RERANK_BASE_URL`.
- `scripts/eval-retrieval.ts` + `evals/finance.jsonl` — four arms, seeded from real documents.

**Measured**

```
arm               recall@8      MRR   exact_id
vector              100.0%    1.000     100.0%
lexical              66.7%    0.667     100.0%
hybrid              100.0%    1.000     100.0%
hybrid+router       100.0%    1.000     100.0%
Router: llm=4 no_filters=2
```

> **The router shows no measured gain, so it ships OFF.** Hybrid already scores a perfect 1.000 on a
> 2-document corpus — there is no headroom to measure. The plan's gate ("strictly better on exact_id
> and filtered") is **not met**. Per-query diagnostics show it clearly does something real —
> "all invoices from Bright Peak Consulting" and "invoices over 2000" both return **nothing** from the
> lexical channel and the correct document once routed — but the aggregate cannot distinguish that
> while the vector channel rescues the same cases. **A bigger corpus is what decides this.**

The harness refuses to print a verdict on an unindexed corpus or when the router produced filters for
zero queries — both would otherwise read as a clean pass.

---

## 3. Stage 3 — Dictation + pathology report drafting

### Step 0 probe (do this before trusting any HF model)

`Qwen/Qwen3-ASR-1.7B-hf` — the model the brief named — has **no HF serverless provider**:

```
POST .../models/Qwen/Qwen3-ASR-1.7B-hf
400 {"error":"Model not supported by provider hf-inference"}
```

The identical failure that ruled out nomic-embed for embeddings. **`openai/whisper-large-v3-turbo`** is
live, returns segment timestamps, and is the default. Swapping is a config change (`lib/asr/index.ts`).

**Capability lost:** Whisper on HF serverless exposes **no context-biasing parameter**, so domain
`biasTerms` cannot be applied at recognition time. `supportsBiasTerms` reports `false` honestly; the
terms are used in the structuring and narrative prompts instead.

**Language hint goes in `generate_kwargs`, not `parameters`:**
```jsonc
// 400: "_sanitize_parameters() got an unexpected keyword argument 'language'"
{ "parameters": { "return_timestamps": true, "language": "en" } }
// 200
{ "parameters": { "return_timestamps": true, "generate_kwargs": { "language": "en", "task": "transcribe" } } }
```

### Built

- `lib/asr/` — backend interface, HF client (retry/backoff mirroring `embedBatch`), selection switch.
- **A dictation is a `Document`**, not a new entity — it inherits storage, jobs, chunking, embedding,
  field values, audit, sharing and quota. The transcript lands in `ocrText`, so dictations are
  searchable through the existing hybrid retrieval with **zero new retrieval code**.
- `lib/provenance-audio.ts` — reuses `scoreMatch` from `lib/provenance`, yields `{startMs, endMs}`
  instead of `{page, bbox}`.
- `lib/report-render/synoptic.ts` — **deterministic, no LLM.** Iterates the *template*, never the
  values, so a value the template doesn't name can never reach a report. Missing required slots render
  a visible `[missing: X]`.
- `lib/report-render/narrative.ts` — LLM prose, constrained to the transcript; an undictated section
  returns the literal `[not dictated]`.
- `models/report-drafts.ts` — drafting and **the only code path that signs**.

### The clinical safety boundary

- Drafts are created `status="draft"` and carry `*** DRAFT — UNSIGNED — NOT FOR CLINICAL USE ***`
  **in the rendered text**, so it survives copy-paste and export.
- Two DB `CHECK` constraints make `signed` unwritable without both a signer and a timestamp.
- A test walks `app/`, `lib/`, `models/`, `components/` asserting that **exactly one file** ever writes
  `status: "signed"`.
- Sign-off requires an authenticated member — unlike `updateDocumentField`, it will not take a null actor.

**Verified end to end** on synthesised speech: audio → transcript (4 segments) → 8 pathology fields
(incl. "the fourteenth of March twenty twenty six" → `2026-03-14`, IHC markers as filterable rows) →
12 field values tagged `asr` → 7 fields pinned to time spans → draft with banner and `[missing: Stage]`
→ signed → audit event → **second sign attempt refused**.

> **Not built:** diarization. Whisper gives timestamps, not speaker labels. If any audio needs
> "who said what", that is a separate piece of work.

---

## 4. Stage 4 — Source tags, query audit, tenant isolation

- `source` on `document_chunks` (`vlm_ocr | asr | llm_structured | manual`), backfilled truthfully from
  the document's own source. Surfaced into assistant citations — verified live, the assistant said a
  fact was *"obtained via `vlm_ocr` (read off the scanned page)"*.
- `document_searched` audit events — retrieval is a disclosure, so it is logged. **The query text is
  deliberately not stored**: it would make the audit trail a second copy of the sensitive data.
- **`lib/workspace-scope.ts`** — a Prisma client extension that throws when a workspace-scoped model is
  queried without a `workspaceId` filter, with an explicit `unscoped()` escape hatch.
- **RLS** (`prisma/migrations/20260819190000_...`, `lib/db-rls.ts`) — policies + a
  `withWorkspace(id, fn)` wrapper issuing `SET LOCAL app.workspace_id` **inside a transaction**, which
  is what makes it safe under PgBouncer transaction pooling.

### Two things you must know before enabling either

**1. The scope guard does NOT default to `throw`.** The plan said it should. Shipping that into a live
app would turn auth, the admin console and the Stripe webhook into an outage. Ladder:

| `DB_SCOPE_GUARD` | Behaviour | Where |
|---|---|---|
| `off` | no checking | **production default** |
| `warn` | logs, does not block | **dev default**; run this in prod until logs are clean |
| `throw` | refuses | the end state |

Running `warn` against real page loads immediately found **5 unscoped queries** (`getFileTemplates`,
`ensureFileWorkbook`, two in `models/spreadsheets.ts`). All are scoped by `fileId` only. **Not
exploitable today** — the page validates file→workspace first — but isolation depends on callers
remembering. `ensureFileWorkbook` even *receives* `workspaceId` and doesn't use it. Each is a one-line
hardening. **Not yet done.**

**2. RLS is bypassed by superusers.** The migration deliberately creates policies but enables RLS on
**nothing**. Verified as a `NOSUPERUSER NOBYPASSRLS` role: unset scope returns 0 rows (fails closed),
workspace A sees only A, `SET LOCAL` does not survive `COMMIT`, cross-workspace `INSERT` refused by
`WITH CHECK`. As `postgres` **every check fails** — superusers ignore RLS, and `FORCE` does not change
that. **A dedicated non-superuser application role is a prerequisite, not a nicety.** Enabling RLS
while connecting as the owner gives the appearance of isolation with none of the effect.

---

## 5. Configuration (all optional; absent = feature off)

```
# Query routing / reranking (Stage 2)
RETRIEVAL_ROUTER_ENABLED = true|false      # default off; no measured gain yet
RERANK_BASE_URL          = <TEI /rerank>   # absent = identity function

# Dictation (Stage 3)
ASR_BACKEND     = huggingface
ASR_BASE_URL    = https://router.huggingface.co/hf-inference
ASR_MODEL_NAME  = openai/whisper-large-v3-turbo   # NOT Qwen3-ASR — see §3
ASR_API_KEY     = <HF token>                      # falls back to EMBEDDINGS_API_KEY
ASR_LANGUAGE    = en                              # empty = auto-detect (not recommended)

# Isolation (Stage 4)
DB_SCOPE_GUARD  = off|warn|throw   # default: off in prod, warn in dev
DB_RLS_ENABLED  = true|false       # requires a non-superuser role first
```

---

## 6. Status

| Item | State |
|---|---|
| Tests | **504 passing** (from 392), `tsc` clean, eslint 0 errors |
| Migrations | 4 new, applied to local pgvector. **Prod needs manual apply in the Neon editor.** |
| Stage 1 | Verified against real DB + real UI upload |
| Stage 2 | Verified; router **off**, gain unproven on a 2-document corpus |
| Stage 3 | Verified end to end, incl. a real microphone recording in-browser |
| Stage 4a | Verified live (source tags in citations, audit events) |
| Stage 4b | Built, runs in `warn`, **5 findings not yet fixed** |
| Stage 4c | Verified in psql as a non-superuser; **not enabled** |

### Known gaps

1. ~~**Report drafting has no UI.**~~ **Closed** (`1e020bb`, after this doc was written): the dictation
   page, template editor, and synoptic/narrative panes now call `createReportDraftAction` /
   `signReportAction` directly. See `HANDOFF-DEEPGRAM-AND-FIELD-SUGGESTIONS.md` for what shipped after.
2. **The 5 unscoped queries** above are unfixed.
3. **The router's value is unmeasured** — needs a corpus with several documents per vendor.
4. **ASR quality is mic-bound.** Real recordings mis-heard "US dollars" as "US Donuts". The pipeline
   handled what it was given correctly; a closer mic or a dedicated endpoint is the fix.
5. ~~**Dictation is pathology-only.**~~ **Closed** (`578769d`, after this doc was written): dictation
   now starts with no fields and discovers them per-recording. See
   `HANDOFF-DYNAMIC-DICTATION-AND-PROD-INFRA.md`, which also covers detached embedding and two
   production infrastructure bugs (unapplied migrations, a `sharp` native-binary crash) found while
   wiring up the embed drain cron.

### Bugs found by using it in the browser (all fixed)

These were **not** caught by 500 unit tests — only by running the thing:

1. `dictationEnabled` never threaded → audio could never be selected.
2. `DictationRecorder` mounted nowhere → dead code.
3. Dictations stored `source: "upload"` → their chunks were tagged `vlm_ocr`, i.e. a dictated snippet
   was cited as though read off a printed page. Now derived from MIME type in one place.
4. `language` never passed → Whisper auto-detected and returned fluent Icelandic for English audio.
   The first fix for this was **wrong** (HTTP 400) and was caught only by testing against the live
   endpoint.
5. `structureTranscript` computed audio provenance then passed `provenance: null` to the projection →
   dictated values could never be cited to the moment they were spoken.

---

## 7. Key files

| Path | What |
|---|---|
| `lib/field-projection.ts` | pure projection of values → typed rows |
| `models/document-field-values.ts` | SQL builders, filter language, completeness query |
| `lib/domains/` | finance / pathology / logistics packs + registry |
| `lib/query-router.ts` | NL → filters + semantic remainder, fail-safe |
| `lib/rerank.ts` | reranker seam (identity by default) |
| `scripts/eval-retrieval.ts` | four-arm harness + `--seed` |
| `lib/asr/` | ASR interface, HF backend, selection |
| `lib/document-transcription.ts` | transcribe job, restructure-never-infer prompt, unsupported-field detection |
| `lib/provenance-audio.ts` | time-span provenance |
| `lib/report-render/`, `lib/report-completeness.ts` | synoptic (deterministic) + narrative (LLM) |
| `models/report-drafts.ts` | drafting; **the only path that signs** |
| `lib/workspace-scope.ts`, `lib/db-rls.ts` | isolation |
