# DocuBite — Dynamic Dictation Fields, Detached Embedding & Production Infra: Handoff

_Last updated: 2026-08-20. Companion to `HANDOFF-DEEPGRAM-AND-FIELD-SUGGESTIONS.md` (built the
suggested-fields mechanism this session made dynamic) and `HANDOFF-STRUCTURED-RETRIEVAL.md`
(Stage 3 dictation base). Both remain accurate; this doc covers what changed on top of them._

Two feature parts (dynamic fields, detached embedding) plus two production infrastructure bugs
found and fixed while wiring up the second one. All four are live on `master` and deployed to
production (`docubite.vercel.app`) as of commit `a1eb205`.

---

## 1. Dictation starts blank, fields are discovered

**Why:** dictation was hard-wired to one industry (`pathology_report`). The goal is multi-industry
dictation where a person approves what the model discovers, rather than every new domain requiring
a hand-written field pack.

**Built:**
- `lib/domains/blank.ts` — new `general_report` adapter, zero fields, `ephemeral: true`. Registered
  in `lib/domains/index.ts`; `DICTATION_TEMPLATE_CODES` now points at it instead of
  `pathology_report`. Pathology stays registered (extraction still works, ASR bias terms still
  resolve) — just unwired from the dictation dropdown, ready to come back as an opt-in preset.
- **Discover mode** in `lib/field-suggestions.ts` — when a template has zero fields, the
  suggestion prompt flips from "last resort, only if it cannot be placed" to "propose one field per
  distinct fact stated," cap raised from 6 to 24, and the model also returns `_suggested_title`
  (parsed by `parseSuggestedTitle`). `lib/document-templates.ts::buildDocumentJsonSchema` omits
  `_confidence`/`_provenance` entirely when there are no fields — with `properties: {}` those would
  otherwise be unsatisfiable schemas that structured-output providers reject outright.
- **Bulk/edited approval** — `models/field-suggestions.ts::acceptFieldSuggestions` accepts several
  suggestions in one call, with per-item label/type/value overrides from the verify screen, minting
  **one** template version for the whole batch (not one per field). `acceptFieldSuggestion` is now a
  one-element wrapper around it.
- **Ephemeral accept** — when the document's domain adapter is `ephemeral` (the blank pack),
  accepting a field writes into the document's own `fieldSnapshot` only; no `DocumentTemplateVersion`
  is minted, no `currentVersion` bump. Every dictation under an ephemeral pack therefore discovers
  its own fields from a blank slate — dictation #2 never inherits dictation #1's fields. Real
  hard-coded packs (pathology) are unaffected and keep today's accumulating behaviour.
- `components/dictation/suggested-fields.tsx` — inline-editable label/type/value per suggestion,
  Accept all / Dismiss all, confidence-ordered.

**Tests:** `lib/field-suggestions.test.ts` gained discover-mode instruction framing, the 24-cap, the
title parser, and `buildDocumentJsonSchema([])` omitting `_confidence`/`_provenance`.

---

## 2. The title

- Migration `20260820000000_add_document_suggested_title` — `Document.suggestedTitle String?`.
- `NewDictation` (`components/dictation/new-dictation.tsx`) gained a Title input; blank posts no
  filename and falls through to the server's timestamp-only default (`dictation-actions.ts`) instead
  of the old composed `"{template name} — {stamp}"`, which no longer names anything specific once
  the template is generic.
- `structureTranscript` writes the model's `_suggested_title` to `Document.suggestedTitle` in
  discover mode only.
- Verify screen (`DictationTitle` in `dictation-workspace.tsx`) makes the title inline-editable and
  offers a one-click "Use: {suggestion}" when a suggestion exists and differs from the current
  filename.
- `renameDictationAction` (`dictation-actions.ts`) — reuses `cleanFilename`/`searchableText`
  (both now exported from `models/documents.ts`) so a rename is findable immediately.
- **Also fixed while here:** the known 500 on audio playback for non-ASCII filenames
  (`app/api/documents/[documentId]/source/route.ts`) — `Headers` values must be Latin-1, and an em
  dash or accented character threw at the point of setting the header. Fixed with RFC 5987
  `filename*=UTF-8''…` plus a pure-ASCII `filename=` fallback.

---

## 3. The report follows the discovered fields

- `lib/report-render/synoptic.ts::synopticFieldsSchema` relaxed to `.min(0)`. An empty list is
  meaningful: "derive from the document's own fields at draft time," not "no slots ever." New
  `renderSynopticText(lines)` factored out of `renderSynoptic` so a **stored** draft's lines can be
  re-rendered verbatim without re-deriving from live document values.
- `models/report-drafts.ts::createReportDraft` — when the report template's `synopticFields` is
  empty, derives slots from the document's `fieldSnapshot` via `deriveSynopticFields`
  (`lib/report-templates.ts`, now generic — `SUPPRESSED_SLOTS` emptied, it was pathology's
  `patient_id`).
- `DEFAULT_REPORT_TEMPLATES` (`lib/report-templates.ts`) is now a single generic "General report"
  seed with empty `synopticFields` and two sections (Summary, Details). The pathology seed is kept
  as `PATHOLOGY_REPORT_TEMPLATE`, exported but no longer in `DEFAULT_REPORT_TEMPLATES` —
  `ensureWorkspaceReportTemplates` upserts by name and never overwrites, so a workspace that already
  had the pathology template keeps it untouched; this only changes what a **new** workspace starts
  with.
- **Heading changed, round-tripping removed.** `"DIAGNOSIS / SYNOPTIC"` → neutral `"SUMMARY"`. More
  importantly, `signReport` and `updateReportDraftNarrative` no longer string-slice the previous
  `renderedText` to recover the synoptic block — they re-render from `draft.synoptic`, which now
  stores the full `SynopticLine[]` (label, value, missing, required) instead of a flat key→value
  map. A heading is UI, not data; parsing it back out broke the moment it stopped being a fixed
  literal.
- `renderReportText` gained an optional `title` param, inserted as its own block right after the
  draft banner — the dictation's own title (`Document.filename`), since the report otherwise has no
  name of its own once it's not "the pathology report for case #…".
- Report template editor (`components/dictation/report-template-form.tsx`) gained Add/remove for
  slots and sections — a newly-added row's key is editable (slugified from the label) until saved;
  an existing row's key stays locked, same invariant as before (a key is what the renderer looks
  values up by).
- De-clinicalised shared copy: `lib/report-render/narrative.ts` prompt intro, the dictation list's
  case-assistant intents (`dictation-workspace.tsx`), and the dictation list summary
  (`app/(app)/workspaces/[workspaceId]/dictation/page.tsx::summarise`) — now reads the document's
  own `fieldSnapshot` order for its first few populated values instead of three hard-coded pathology
  keys (`accession_no`, `specimen_type`, `anatomical_site`).

**Tests updated:** `lib/report-templates.test.ts` (seed is now generic; `deriveSynopticFields` no
longer suppresses anything by default), `models/report-drafts.test.ts` (title-in-report,
SUMMARY heading), `models/report-draft-narrative.test.ts` (fixture updated to the new `synoptic`
shape and `document.filename`).

---

## 4. Detached embedding

**Finding, not assumed:** upload was *already* async before this session — extraction/transcription
run in `after()`, report drafting is not gated on embeddings. The real problem was narrower: the
embed job is `await`ed at the tail of whichever job produced the text (`document-processing.ts`),
inside the *same* invocation, so OCR/ASR + LLM + embedding all bill to one function lifetime — and on
a timeout the document is silently left unindexed.

**Built:**
- `kickEmbedJob(jobId)` (`lib/document-processing.ts`) replaces the two inline
  `await processDocumentJob(embedJobId)` calls. Default (`EMBED_DETACHED` unset/false): identical,
  awaited in-process. Detached: a fire-and-forget POST to `/api/internal/jobs/process` — the
  producing request returns as soon as its own work is done; the embed runs in a **separate**
  invocation.
- `config.embeddings.detached` (`lib/config.ts`) — gated on `EMBED_DETACHED=true` **and**
  `INTERNAL_WORKER_SECRET` being a real (non-placeholder) value, so it cannot be switched on without
  working bearer auth behind it.
- `models/documents.ts::getDocumentsStatus` gained a real `indexing` signal — an actual
  queued/processing embed job exists — replacing the old "not searchable yet" tick-guess.
  `components/extract/use-extraction-progress.ts` now stops polling on `indexing: false` rather than
  a fixed 24-tick budget (kept only as a backstop for a somehow-stuck flag). "Indexing… → Searchable"
  pill added to both `components/extract/file-row.tsx` and the dictation verify screen
  (`dictation-workspace.tsx`, auto-refreshing every 3s while indexing).
- **Drain driver: cron-job.org, not Vercel's own cron.** Vercel Hobby only allows daily crons;
  `/api/internal/jobs/process` (POST, bearer-authed, drains one queued job or a specific `jobId`) has
  nothing Vercel-specific about it, so an external cron works just as well and needs no `vercel.json`
  change. **Configured and verified working against production** this session.

**Config:**
```
EMBED_DETACHED = true|false   # default false; requires INTERNAL_WORKER_SECRET + a drain driver
```

**Status as of this handoff: ON in production.** `EMBED_DETACHED=true` is set in Vercel (Production
scope only, not Preview), and a redeploy (`a1eb205`, empty commit — env var changes only take effect
on the *next* deployment, not retroactively) has been pushed and confirmed live by the user. The
cron-job.org drain job is configured against `https://docubite.vercel.app/api/internal/jobs/process`
with the production `INTERNAL_WORKER_SECRET` and returns `200` (not verified against a queue that
actually had a job in it — see gaps below).

---

## 5. Production infrastructure bugs found and fixed

Both found while getting the drain cron working — neither is new from this session's feature code,
both were pre-existing and silent.

### 5a. Eight migrations were never applied to production

`master` had drifted 8 migrations behind the deployed Neon database (the last several sessions'
dictation/reports/field-suggestions/RLS-scaffolding work never got a manual `migrate deploy` against
prod — see the standing "prod needs manual apply" note from earlier handoffs). One of the eight,
`add_document_chunks`, hit `P3018: relation "document_chunks" already exists` — that table had been
created out-of-band (RAG work) without Prisma's migration history knowing. Verified its columns and
indexes matched the migration's expected shape exactly, then `prisma migrate resolve --applied` on
that one before running `migrate deploy` for the rest. All 8 applied cleanly;
`prisma migrate status` now reports the production database up to date.

### 5b. `sharp` crashed every extract/embed job in production

**This was a real, previously-undiagnosed bug independent of anything built this session** — it
means webp/heic upload extraction had likely been silently failing in production for a while,
discovered only because the drain route's error was finally being logged.

- The route's catch block (`app/api/internal/jobs/process/route.ts`) was swallowing errors with no
  `console.error` — a `500` with zero diagnostic trail. Added logging first, which is what actually
  surfaced the real error in Vercel's function logs.
- Real error: `ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3: cannot open shared object file`. Two
  contributing causes, fixed in sequence (each verified live against production before moving to the
  next — the first fix alone did NOT resolve it, confirmed by re-testing):
  1. `next` declares its own `sharp@^0.34.5` as an optional dependency (for `next/image`, unused here
     — `images.unoptimized: true`), so npm installed a second, older `sharp` nested under
     `node_modules/next` alongside the root `sharp@0.35.3`. Collapsed to one version via a
     `package.json` `overrides` entry; confirmed the nested `@img/sharp-*` entries are gone from
     `package-lock.json` (501 lines removed).
  2. Even with one version, the crash persisted — confirmed via a from-scratch, zero-build-cache
     Vercel redeploy. Root cause: `sharp` loads its native `libvips-cpp.so` via a runtime `dlopen`,
     not a statically traceable `require()`/`import`, so Vercel's file tracer (`@vercel/nft`) never
     sees it needs including and leaves it out of the deployed function bundle entirely — the binary
     was genuinely missing at runtime, regardless of which version resolved at install time. Fixed
     with `outputFileTracingIncludes` in `next.config.ts`, force-including
     `node_modules/sharp/**` and `node_modules/@img/**` across every route. **This is the fix that
     actually worked** — confirmed by the response changing from `500` (crash) to a clean `401`
     (correct auth rejection reaching our route code) with no `Authorization` header sent.

---

## 6. Known gaps

1. **No live in-browser verification this session.** The plan's step-3 verification (record a real
   non-medical dictation, confirm discover mode, accept fields, draft/sign report, confirm dictation
   #2 starts blank) was **not done** — this session went straight from implementation to production
   infra debugging once the user started wiring up the cron. Everything above is verified at the
   `tsc`/test level (553 passing, 17 new) and the infra fixes are verified live against production,
   but the actual dictation UX has not been exercised end to end since these changes landed.
2. **`EMBED_DETACHED=true` has not been verified against a real queued embed job** — only that the
   drain route itself responds correctly (`401` without auth, `200` with a real request per the
   user's own cron test). The fire-and-forget kick path in `kickEmbedJob` and the
   Indexing→Searchable pill flip have not been watched end to end in production.
3. **The ngrok tunnel used for local testing this session is throwaway.** If a cron-job.org entry
   still points at an `ngrok-free.dev` URL, it will start failing whenever that tunnel isn't running
   locally — worth deleting once the production entry is confirmed sufficient.
4. Carried over from prior handoffs, still true: the 5 unscoped queries (Stage 4b) are unfixed, the
   router's value is unmeasured, RLS is installed but not enabled.

---

## 7. Local dev environment notes from this session

- `structured-retrieval-dictation-isolation` was fast-forward merged into `master` in one shot —
  master had been behind by several sessions' worth of work (Deepgram, AI-suggested fields, the
  dictation UI itself), not just this session's changes. Anyone else with a local branch off the old
  `master` should rebase.
- Local dev DB (Docker pgvector, `docubite-dev-pg` on `55432`) already had the new
  `suggested_title` migration applied and tested before touching production.
- ngrok is not installed in this environment by default and downloading/running an external binary
  is blocked by the sandbox's safety classifier — install it yourself
  (https://ngrok.com/download) if you need a local tunnel again; `ngrok config add-authtoken` +
  `ngrok http 7331` gets a public URL forwarding to the local dev server in a couple of seconds once
  installed.
