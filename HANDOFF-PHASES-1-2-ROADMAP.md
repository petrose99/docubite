# Handoff — Competitive roadmap Phases 1–2 (Foundation + Accounting core)

**Branch:** `claude/docubite-phases-1-2-roadmap-b881ce` (worktree `marketing-ui-audio-review-e977c4`)
**Date:** 2026-08-27
**Status:** **Code-complete and locally green.** `npx tsc --noEmit` clean, `npm test` **896 pass** (90 files) run under `DB_SCOPE_GUARD=throw`, eslint clean on every changed file. Migrations applied and verified against a real Postgres (Docker `docubite-dev-pg`, pgvector, port 55432) — not just `prisma validate`. Several flows (Tax region save, Supplier rule creation, workspace-mode picker) were clicked through live in-browser against that database. **Nothing committed** — 49 modified files, 59 new files, all sitting in the working tree.

This lands all 14 work packages of the plan: WP0–WP6 (Foundation) and WP8–WP13 (Accounting core). WP7 doesn't exist in the numbering (the plan jumps WP6→WP8).

---

## Quick orientation for the next session

- **Read the memory file** `p1-integrations-foundation-progress.md` and its siblings first — this branch is unrelated to the P1 integrations work (webhooks/API keys), which already shipped separately. Don't confuse the two.
- **Local DB**: `docubite-dev-pg` (pgvector, port 55432) is a *stopped-by-default* Docker container — `docker start docubite-dev-pg` before anything DB-related. `DATABASE_URL` in `.env` already points at it.
- **Turbopack dev cache bug, recurring**: after `next.config.ts` edits (or sometimes just on a bare `next dev` restart), pages under the `(chrome)` route group (`settings/*`) 404 while everything else works. Fix every time: stop the server, `rm -rf .next`, restart. Confirmed happened 3 separate times this session, always fixed the same way. **Don't waste time debugging it as an app bug — it isn't one.**
- **Demo accounts**: `npm run db:seed` (stop the dev server first — the seed script needs the one available connection). Seeds `admin@docubite.local` / `demo-starter@docubite.local` / `demo-growth@docubite.local` / `demo-enterprise@docubite.local`, all password `<role>-docubite-2026` or `demo-<plan>-2026`. All default to `productMode: "accounting"`.
- **Lint changed files explicitly** — repo-wide `npm run lint` OOMs on worktree `.next` dirs (pre-existing, unrelated to this branch).

---

## Phase 1 — Foundation

### WP0 — Security quick wins
- Fixed 5 unscoped Prisma queries: `getFileTemplates` (`models/files.ts`) and `getWorkbook`/`saveWorkbook`/`ensureFileWorkbook` (`models/spreadsheets.ts`) now all take `workspaceId` and filter by it. All call sites updated.
- `DB_SCOPE_GUARD` now defaults to `throw` in production, `warn` in dev (`lib/config.ts`); `lib/db.ts`'s scope-guard extension now reads the resolved `config.isolation.scopeGuard` instead of raw `process.env.DB_SCOPE_GUARD` directly (it was bypassing the config layer entirely before).
- New `lib/verify-production-config.ts` — fail-fast boot check (hard: scope guard=throw, malware scan URL, Stripe-if-`ENFORCE_PLAN_LIMITS`; soft: Sentry DSN, explicit `ENFORCE_PLAN_LIMITS`). Wired into `instrumentation.ts`'s `register()` and `worker/job-worker.ts`'s startup.
- `.github/workflows/ci.yml` test job now runs with `DB_SCOPE_GUARD: throw`.

### WP1 — Clean-build CI + enforced nonce CSP
- New `lib/csp.ts`: pure `buildCsp(nonce)` + `generateNonce()` (Web Crypto, edge-runtime-safe).
- `proxy.ts` now generates a nonce per request, sets it as `x-nonce` on the request (Next auto-nonces its own injected scripts from this), and sets `Content-Security-Policy-Report-Only` (or `Content-Security-Policy` once `CSP_ENFORCE=true`) on the response. `next.config.ts`'s old static CSP header is gone — the other static headers (X-Frame-Options, HSTS, etc.) stay there.
- New `app/api/csp-report/route.ts` — logs violations to Sentry via `contexts` (not `extra`, which `lib/sentry-scrub.ts` strips wholesale), scrubbed with `scrubUuids`.
- New CI `build` job: `pgvector/pgvector:pg16` service container → `prisma migrate deploy` → `next build` (new `build:ci` script) with CI-only dummy secrets. **This is the first time fresh-DB migrations have ever been validated in CI.**

### WP2 — `Workspace.productMode` (the keystone)
- New column `product_mode TEXT NOT NULL DEFAULT 'accounting'`, backfilled to `'clinical'` where `hipaa_mode = true`.
- `types/product-mode.ts` (the `"accounting" | "clinical"` union + `parseProductMode`), `models/workspaces.ts`'s `setProductMode()` — **locks permanently once the workspace has any `DocumentFile`**, coupled to `hipaaMode` (can't leave clinical while HIPAA mode is on).
- **Important interaction, discovered live in this session, not in the original plan**: `createWorkspaceForUser` seeds a file *immediately* on creation (`createFile()` a few lines later in the same function) — so a workspace is never actually "empty" even for a moment. That means `setProductMode` is realistically only usable **at creation time**, not as a true post-hoc setting. This drove the follow-up work described below.
- Sidebar/route gating: `Sidebar` takes `reviewQueueEnabled`/`rulesEnabled`/`taxSettingsEnabled` (all accounting-only) and `dictationEnabled` (now `config.asr.enabled && productMode === "clinical"`, not just the config flag). Dictation routes/actions/the stream route all re-check `productMode` server-side too (a hidden nav link is not an access control).
- **Follow-up landed in this same session** (user asked "where is dictation"): the "Create a team workspace" form (`components/workspace/team-workspace-form.tsx`) now has a mode picker, threaded through `createWorkspaceAction(name, productMode)` → `createTeamWorkspace(user, name, productMode)`. **The lazily-created personal workspace (first `/workspaces` visit) still has no picker and always defaults to accounting** — there's no onboarding step in that path to ask the question. If clinical-by-default personal workspaces matter, that's a real, not-yet-built gap.

### WP3 — Clinical ASR/BAA gating
- New `Workspace.asrExternalAllowed` (bool, default false). New `lib/asr/gating.ts`'s `isAsrAllowed()`: allowed unless (clinical AND hipaaMode AND NOT asrExternalAllowed).
- Enforced at: the dictation page (shows a "pending BAA coverage" message instead of 404), `createDictationAction`, and `/api/dictation/stream` (403 `baa_required`).
- New admin page `app/admin-next/baa/` (list of hipaaMode workspaces + a toggle) — writes an `AdminAuditEvent` on every change, which is why it's a bespoke page and not a next-admin generated field (see `next-admin-options.ts`'s own comment on why `Workspace.hipaaMode`/`productMode` are excluded from the generated editor for the same reason).

### WP4 — Versioned `TaxProfile`
- `TaxProfile` (one per workspace) + immutable `TaxProfileVersion` rows, versioned exactly like `DocumentTemplate`/`DocumentTemplateVersion`.
- `lib/tax/types.ts` + `lib/tax/regions/{za,ls,gb,us}.ts` + registry (`lib/tax/regions/index.ts`, validates every region against its own schema at import time). Rates carry `effectiveFrom`/`effectiveTo` — this is the shape WP12's tax-consistency check needs to compare a document against whatever rate was actually in force on its date, not today's rate.
- **Rate accuracy was verified with live web search, not assumed** — see the comments in each region file. One genuine correction: Lesotho's standard VAT rate conflicting-source situation is flagged explicitly in `lib/tax/regions/ls.ts`'s comment; it should be confirmed against RSL's official schedule before this feeds a real compliance decision.
- US: `rates: []` deliberately — state/local sales tax rate tables are an explicit plan deferral, not something invented here.
- New `settings/tax` page (accounting-mode only), sidebar entry.

### WP5 — First-party analytics
- New `ProductEvent` table (workspace-scoped by convention but NOT in `WORKSPACE_SCOPED_MODELS` — admin rollups read across every workspace, same reasoning as `AdminAuditEvent`).
- `lib/analytics.ts`'s `track()`: every event has a `.strict()` zod schema — an unexpected key (a filename, a search query) fails validation and is dropped with a `console.error`, which is the actual enforcement of "no PII in analytics," not just a comment. Events wired: `document_uploaded`, `document_extraction_completed`, `document_correction_saved`, `document_exported`, `automation_rule_corrected`, `document_check_failed`.
- `lib/analytics-rollups.ts` (raw SQL — median needs `percentile_cont`, not expressible in Prisma's query builder) + `app/admin-next/analytics/page.tsx` (6 headline metrics, trailing 7 days).
- 90-day retention sweep in `worker/job-worker.ts`, gated to run once an hour, not every idle tick.

### WP6 — Marketing split + self-serve pricing
- Real `/pricing` page (was `redirect("/demo")`) rendering `WORKSPACE_PLANS`/`TRIAL_DAYS` directly — CTA is `/signup?plan=<code>` for self-serve plans, `/demo` for Enterprise.
- Homepage is now a light chooser (`Hero` + `TrustStrip` + new `ModeChooser` section + `Security` + `Faq` + `CtaBand`) instead of carrying every section for both audiences. New `/accounting` (self-serve, `Hero variant="accounting"`) and `/clinical` (demo-led, `Hero variant="clinical"`) pages carry the deep pitch that used to live on the homepage.
- `Hero` and `CtaBand` both take a `variant`/`variant` prop now (`"default" | "accounting" | "clinical"` and `"demo" | "selfServe"` respectively) instead of being single-purpose.
- **Truthful-copy purge, then partial restoration**: deleted bank-statement/PO/payment-method/category claims (WP6), then restored them truthfully once WP8 actually shipped those templates (bank_statement, purchase_order, expense_receipt) — see `lib/solutions.ts`'s new `expense-receipts` solution entry, which is careful to only claim what `expense_receipt`'s fields actually are (no line items, no hardcoded category list).
- Fixed a real bug I found while doing this: `DictationDemo`'s marketing mock showed a *financial expense-logging* dictation example, which directly contradicted WP2's gating (dictation is now clinical-only). Changed the mock to a pathology specimen example.
- `PRODUCT_LINKS` (footer/nav anchors) repointed from `/#extraction` etc. to `/accounting#extraction` / `/clinical#dictation` — those sections no longer live on the homepage.

---

## Phase 2 — Accounting core

### WP8 — Finance template expansion
- `lib/domains/finance.ts` split: `FINANCE_TEMPLATES` (seeded into every new file — now **4** templates: invoice, receipt, **expense_receipt** (new), generic) vs `FINANCE_OPTIONAL_TEMPLATES` (bank_statement, purchase_order, remittance_advice, supplier_statement — offered via the existing domain-pack picker, the same mechanism pathology/logistics already used).
- `expense_receipt`'s `tax_code`/`category` fields are deliberately generic in their extraction instructions — no hardcoded rate/category list (the "not hardcoded" constraint from the plan). The real vocabulary is a workspace's `TaxProfile`, consumed by WP12's checks, not injected into the extraction prompt in this pass (a real, acknowledged scope cut — see Known gaps below).
- `lib/domains/index.ts`'s `extractionDomainPacks()` now excludes each domain's seeded codes from its own picker (previously only mattered for pathology/logistics, which have no seeded overlap; finance now does).

### WP9 — Durable ingestion + ZIP/batch
- New `IngestionItem` (workspace-scoped): `idempotencyKey` = sha256 of raw bytes, **unique per workspace** (broader than `Document`'s own `(fileId, sha256)` uniqueness — this catches a re-sent email or re-uploaded ZIP regardless of which file it'd land in).
- New `lib/ingestion.ts`'s `createIngestionItem()` — hash → idempotency short-circuit → malware scan → `createDocumentFromBuffer`, each step recorded, never throwing a rejection past the caller. **A subtle correctness fix made mid-implementation**: only a *documentId-bearing* prior item short-circuits as duplicate — a prior *rejected/failed* attempt at the same bytes is retried (upserted onto the same row), so a transient malware-scanner outage doesn't permanently block re-upload of the same file.
- New `lib/zip-ingestion.ts`: `unzipSync` (fflate, already a dependency), entry cap (200), cumulative-uncompressed-bytes cap (200MB, the actual zip-bomb defense — the 52MB body limit only bounds the *compressed* upload), and zip-slip defense via `cleanFilename` (`path.basename`) on every entry name — tested explicitly with `"../../../../etc/evil.pdf"` and absolute-path fixtures.
- `uploadDocumentsAction` and the new `uploadZipAction` both thread through `createIngestionItem`; the extract panel got an "or upload a ZIP" button reusing the exact same polling (`onDocumentsQueued`) as ordinary uploads.

### WP10 — Review queues
- New `ReviewTask` (status `open|in_review|approved|rejected`, reason `manual|low_confidence|rule_required|check_failed`, assignee, priority, dueAt) + `models/review-tasks.ts`. Every status transition writes a `DocumentAuditEvent` — including bulk transitions, one event per task, not one event for the whole batch (the audit trail has to answer "who approved *this* document").
- **`ReviewComment` and `ReviewSavedFilter` were deliberately not built** — the plan itself frames them as follow-ups once table+detail+bulk are shipped and in use. Don't build them speculatively; wait for real usage to ask for them.
- New `/review` route (queue table, bulk approve/reject) and `/review/[taskId]` (detail: source-document preview via the existing `DocumentPreview` component + read-only extracted fields + status/assignee controls + — once WP12 landed — the document's `DocumentCheckResult` rows). Accounting-mode only, both client- and server-gated.

### WP11 — Supplier automation rules
- New `AutomationRule` (matcher: `{type: "exact"|"contains", value, templateCodes?}`, actions: `{codingData: {...}}`, `minConfidence`, `requireReview`, `hitCount`). Pure engine in `lib/automation/rules.ts`'s `applyRules()` — **18 table-driven tests**, including a permutation test proving precedence (exact > contains, then oldest) is stable regardless of array order.
- New `Document.codingData`/`appliedRuleId` columns — a rule's output lands here, not in `reviewedData`, because a template has no "cost centre" field to validate it against; this is classification metadata layered on top of extraction.
- Run in the worker right after extraction commits, via `applyAutomationRules()` in `models/automation-rules.ts`. Three independent conditions open a `ReviewTask` (reason `rule_required`): a match below the rule's `minConfidence`, a rule flagged `requireReview`, or **no match at all when active rules already exist for this template** ("no_match_risky" — a new supplier nobody's told the system about yet).
- "Update rule" correction flow: editing a rule's matcher/actions writes `rule.updated` audit + `automation_rule_corrected` analytics (only for an actual matcher/actions change, not an `isActive` toggle) — never rewrites what already-applied documents got.
- New `settings/rules` page: create-rule form + a table with hit counts + an active/inactive toggle.

### WP12 — Deterministic checks
- New `DocumentCheckResult` (`@@unique([documentId, checkCode])` — a table, not Json, so it's queryable). Five checks, three fully pure (`lib/checks/arithmetic.ts`, `balance.ts`, `tax-consistency.ts`, `statement-periods.ts` — **39 table-driven tests total**), two DB-backed (`duplicates.ts`'s pure near-dupe matcher + `models/document-checks.ts`'s DB orchestration for exact-duplicate lookup and suspicious-resubmission history).
- Currency-aware tolerance (`lib/checks/types.ts`): half a minor unit, with a zero-decimal-currency table (JPY, KRW, etc.) so `100.001` doesn't false-positive on `100` but a genuine one-cent (or one-yen) discrepancy does fail.
- Only `invoice_arithmetic` and the *exact-match* branch of `duplicate` default to `fail`; everything else (statement balance, tax consistency, near-dupe, suspicious resubmission, missing statement periods) defaults to `warn`, per the plan's explicit severity call.
- **A real bug I introduced and fixed within the same work package**: my first draft of "suspicious resubmission" only ever checked the single most-recent rejected `ReviewTask` workspace-wide, with a filter condition that was pure filler (`reviewedData: { path: [], not: JsonNull }` — always true, did nothing). Rewrote it to fetch up to 200 recent rejected tasks and actually match on supplier+invoice number. Caught this myself while writing the summary, before running any tests — worth being suspicious of your own first draft on cross-document DB queries specifically.
- Runs in the worker right after WP11's rule application (per the plan's own ordering: "a check comparing against `codingData` needs the rule's coding to already be on the document").

### WP13 — Camera + email intake (deliberately last, trimmed)
- **Camera**: `capture="environment"` file input in the extract panel ("or take a photo"), client-side downscale via `components/extract/downscale-image.ts` (canvas, max 2400px, JPEG q=0.85) before upload — a phone's 10MB original never leaves the device. `Permissions-Policy`'s `camera=()` removed from `next.config.ts`. The existing `public/site.webmanifest` already supports add-to-home-screen (`display: standalone`) — nothing new needed there.
- Both camera and ZIP uploads now correctly tag `document_uploaded` analytics with their real channel — this required moving the `track()` call from inside `createDocumentFromBuffer` (which only ever sees `document.source` = `"upload"`/`"dictation"`, collapsing camera/zip/email/api) up into `lib/ingestion.ts`'s `createIngestionItem()`, which is the one place that actually knows the intake channel. **Fixes a latent bug from WP9**: ZIP uploads were being mis-tagged as plain "upload" in analytics before this.
- **Email, shipped dark**: `Workspace.inboundEmailToken` (opaque, unique, generated lazily, never for a clinical workspace), `app/api/inbound-email/route.ts` (Postmark inbound webhook shape), bearer-secret verification (`EMAIL_INBOUND_SECRET`, unset by default — the whole route 503s until configured), per-workspace sender allowlist (workspace members only), disabled entirely for clinical workspaces (checked twice: no token is ever issued for one, and the route re-checks anyway in case mode changed after issuance).
- Fixture-driven tests only, per the plan — `vitest.config.ts`'s `include` glob was extended with one narrow entry (`app/api/inbound-email/**/*.test.ts`) specifically because this is the one route with no other way to verify it before a real provider exists. This is **not** a general invitation to unit-test `app/api/**` — every other route in this repo is deliberately untested at this layer.

---

## Known gaps — real, not hidden

1. **Lazy personal-workspace creation has no mode picker.** Only the explicit "Create a team workspace" form does (see WP2 above). A brand-new solo user always gets an accounting workspace.
2. **Tax-vocabulary injection into extraction prompts** (WP8's parenthetical: "category/tax vocab referenced from TaxProfile at prompt-assembly") was not built — `expense_receipt`'s fields stay generic-instruction-only. WP12's tax-consistency check is the real, built consumer of `TaxProfile`; prompt-time injection would need a DB read inside `buildDocumentPrompt`'s call site and was judged disproportionate for what it'd add.
3. **`ReviewComment`/`ReviewSavedFilter`** (WP10) — not built, per the plan's own "follow-up" framing.
4. **Lesotho's VAT rate** (`lib/tax/regions/ls.ts`) has one non-authoritative source disagreeing with the others used. Flagged in the file's own comment; confirm against RSL's official schedule before this feeds a real compliance decision.
5. **Camera capture and email intake are UI/route-complete but never exercised against real hardware or a real inbound-email provider** — no phone tested the capture flow, no DNS/Postmark/SES account exists yet for email. Both are fixture/unit-tested only, exactly as the plan asked ("shipped dark").
6. **Regional connectors (Xero/QuickBooks push) and clinical scale-out** are explicitly out of scope for Phases 1–2, per the original plan.

---

## Verification performed

- `npx tsc --noEmit` — clean, checked after every work package, not just at the end.
- `npm test` — 896 tests passing, 90 files, run under `DB_SCOPE_GUARD=throw` (the production mode) every time, not just at the end.
- `npx eslint <changed files>` — clean, run after every work package (repo-wide `npm run lint` OOMs on worktree `.next` dirs — pre-existing, unrelated).
- **All 9 new migrations applied with `prisma migrate deploy` against a real Postgres** (`docubite-dev-pg`), not just validated. This is the first time in this project's history that this session's migrations were tested against a from-scratch-equivalent real database rather than only `prisma validate`.
- Live in-browser, logged in as seeded demo accounts:
  - Marketing: homepage, `/pricing`, `/accounting`, `/clinical`, `/solutions` — all render, no console errors, CSP Report-Only violations logged but non-blocking (expected).
  - App: `/files` loads with real seeded data; `settings/workspace`'s Product Mode toggle renders; `settings/tax` — picked South Africa, clicked Save, **confirmed a real row in `tax_profiles`**; `/review` — renders, correctly empty; `settings/rules` — created a rule through the actual form, confirmed it round-trips and displays with hit count.
  - **Created a real clinical-mode workspace through the new creation-time picker** ("Pathology Lab"), confirmed `product_mode = 'clinical'` in the database, confirmed the sidebar correctly shows Dictation and hides Tax/Review/Supplier rules for it.
- **Not verified live**: camera capture (no phone), email intake (no provider), the full worker pipeline end-to-end on a real uploaded document (automation rules + deterministic checks actually firing on a real extraction) — these are covered by unit/integration tests with mocked Prisma, not a live document upload + worker run. If the next session has time, uploading a real invoice PDF through a fresh accounting workspace and watching a rule apply + a check fire + a review task appear would be the single highest-value live check left to do.

## How to run locally
```bash
docker start docubite-dev-pg
DATABASE_URL="postgresql://postgres:postgres@localhost:55432/document_inbox" npx prisma migrate deploy
npm run db:seed   # dev server must be stopped first
npm run dev       # if settings/* pages 404, stop, rm -rf .next, restart
npx tsc --noEmit
DB_SCOPE_GUARD=throw npm run test
```
