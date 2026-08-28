# Handoff — Industry Workspaces + Modules

**Branch:** `claude/industry-workspaces` (this worktree: `extracted-data-search-ai-ed0cdb`)
**Date:** 2026-08-28
**Status:** Parts 0–6 of the approved plan, including both previously-deferred pieces (costs-inbox split view, finance-agent Act tools), are built and committed (`d9d1b73` → `9d6fd57`). `tsc` clean, 942/942 vitest, every migration applied to the Docker dev DB. A real end-to-end walkthrough against the live database surfaced and fixed two pre-existing production bugs — see below. The one thing genuinely not done is a logged-in browser click-through, blocked by this environment having no real Supabase project (not something to work around by faking auth).

---

## Quick orientation for the next session

- **Read memory first**: `MEMORY.md` has entries for this repo (it's DocuBite, not TaxHacker, despite the folder name), the local dev DB, and prior related work.
- **Local DB**: Docker container `docubite-dev-pg`, pgvector, real port **55432**. `.env`'s `DATABASE_URL` now points there correctly (fixed this session — it was stale at `55433`, a leftover from before this branch merged past the Supabase Auth migration). If a *different* worktree's `.env` still says `55433`, don't trust it there; pass `DATABASE_URL` explicitly.
- **`npm install` may be needed** — this worktree's `node_modules` was missing `@supabase/ssr` entirely (present in `package.json`, absent on disk) until this session ran `npm install`. If `next dev`/`next build` fails with `Module not found: Can't resolve '@supabase/ssr'` (or any other package genuinely in `package.json`), that's this — `npm install` fixes it, no source change needed.
- **Prisma client after any schema.prisma edit**: `npm run db:generate`.
- **Lint changed files explicitly** — repo-wide `npm run lint` OOMs on worktree `.next` dirs.
- **Verification loop used throughout this build**: `npx tsc --noEmit` → `DB_SCOPE_GUARD=throw npx vitest run` (942/942 as of this handoff) → apply any new migration with explicit `DATABASE_URL` → lint the changed files.
- **No real Supabase project is configured in this worktree** — `NEXT_PUBLIC_SUPABASE_URL` is a placeholder domain. Signup/login cannot work, and there is no local Supabase CLI stack and no auth bypass; `lib/admin.ts`'s admin console needs the same real session. A future session that needs an actual logged-in browser walkthrough needs a real (even a free-tier) Supabase project's URL/anon key in `.env` first — don't try to fake a session.
- **A live-browser check of this worktree needs its own dev server, started directly** (`npm run dev`, or `next dev -p <port>` via Bash with an explicit `DATABASE_URL`), not the Browser-pane `preview_start` tool if this session reached its current worktree via `EnterWorktree` — see the "Tooling gotcha" note below for why.

---

## Tooling gotcha found this session (read before trying to preview anything)

If a session switches worktrees mid-session with `EnterWorktree({path: ...})`, the Bash/Read/Write/Edit tools follow the switch, but **the Browser-pane `preview_start` tool does not** — it keeps launching the dev server from whatever worktree the session originally started in. This produced a genuinely confusing hour of debugging: a marketing-copy change was on disk, verified by every static check, yet never appeared in the browser — because the browser was rendering a *different* worktree's `lib/solutions.ts` the entire time, silently, with no error. Confirmed by comparing `.next` directory timestamps across all three candidate checkouts right after a clean restart — only the *original* worktree's `.next` was freshly touched.

If a future session needs to actually see its own worktree's changes in a browser: start the dev server directly via Bash (`npm run dev -- -p <port>` with `DATABASE_URL` set, backgrounded), confirm it's serving the right content with `curl`, and only then point `preview_start` at it with the explicit `{url: "http://localhost:<port>/..."}` form (which does accept an arbitrary URL rather than resolving a named launch config). Don't trust `preview_start({name: "..."})` after an `EnterWorktree` switch without checking first.

---

## What's done (commits `d9d1b73` through `9d6fd57`)

### Part 0 — Merge, Part 1 — `productMode` → `industry` rename
Unchanged from the prior handoff: clean fast-forward merge to master, migration + schema + `types/industry.ts` + the mechanical rename across ~37 files. See `git show 40d5d75` / `git show d9d1b73` for detail.

### Part 2 — Module registry + capabilities (`b2f32f1`, `69e0ff5`)
- **Migration B** (`20260828010000_add_workspace_modules`): `WorkspaceModule` table, inert RLS policy. Registered in `WORKSPACE_SCOPED_MODELS`.
- **`lib/modules/index.ts`**: `ModuleDefinition`, `MODULES` (17 rows), `findModule`, `modulesForIndustry`, `INDUSTRIES`.
- **`lib/modules/capabilities.ts`**: `resolveModules`, `getWorkspaceCapabilities`, `requireModule`.
- **`models/modules.ts`**: `setModuleState`, `getWorkspaceModuleOverrides`.
- **`lib/industry.ts` (assertMode) deleted** — no real call sites outside its own test.

### Part 3 — Construction pack, seeds, industry pickers (`69e0ff5`, `84f6e0c`)
- **`lib/domains/construction.ts`**: 5 templates + bias terms, registered in `lib/domains/index.ts`.
- **`lib/modules/seeds.ts`**'s `seedTemplatesForIndustry` fully wired and **actually called** from `createWorkspaceForUser`.
- **Fixed the flagged inconsistency**: the lazy personal-workspace path now defaults `industry` to `"general"`, not `"finance"`.
- **`components/workspace/industry-picker.tsx`**: shared 5-industry card set, used by the toggle, the team form, and `/workspaces/new`.
- **`app/(app)/workspaces/new/`**: brand-new user's first-workspace picker; `/workspaces` redirects a zero-membership user there.

### Part 4 — Sidebar/layout wiring, gates, persona, marketing (`69e0ff5`, `d2704c8`)
- Sidebar/layout: five ad-hoc booleans → `enabledModuleKeys` from `getWorkspaceCapabilities`.
- Every ad-hoc `workspace.industry !== "..."` gate → `getWorkspaceCapabilities(...).has("<module>")`.
- Assistant persona addendum, gated on `finance-agent`.
- Marketing: Construction added to `lib/solutions.ts`'s `INDUSTRIES` — **verified rendering correctly in a real browser this session** (see "Live verification" below).

### Part 5 — Modules catalog, statement-packs materialization (`84f6e0c`, `d2704c8`)
- Modules catalog page + `module-actions.ts` (owner enable/disable, any member request) + `module-row.tsx`.
- `addDomainPackToWorkspace`: enabling a `domainPack` module materializes worksheets into every existing file immediately.

### Part 5a — Costs-inbox: chips AND split view/keyboard nav, now complete (`9343dc7`, `e0a6939`)
- Confidence dot, "Rule applied" chip, per-check chips, real empty state (done earlier in this branch's history).
- **`components/workspace/review-inbox.tsx`** (replaces `review-queue-table.tsx`): a keyboard-driven split view — list on the left, the selected document's preview/fields/status/push controls on the right (reusing `DocumentPreview` and `AutomationRuleForm`). `j`/`k` move the selection, `e` approves, `p` pushes when push-eligible; all three optimistic (a row leaves its current status tab immediately) with an undo toast. Bulk approve/reject bar is now sticky. `getReviewTaskDetailAction` (new, in `review-actions.ts`) feeds the pane in one round trip.

### Part 5b — Autopublish, create-rule, pushable-codes consolidation (`d2704c8`, `976fa9f`)
- Migration C (`AutomationRule.autopublish`), `lib/automation/autopublish.ts` wired into rule application and review approval.
- "Create a rule from this document" on the document detail page and the review-task detail page.
- Consolidated three hardcoded pushable-template-code sets into `capabilities.pushableTemplateCodes` — fixed a real drift (`expense_receipt` was pushable in the registry but missing from two of the three copies).

### Part 5c — Finance agent, now complete: read tools AND Act tools (`1d1999e`, `42bc712`)
- **Read tools** (`lib/finance/inbox.ts`): `get_inbox_summary`, `find_supplier_documents`, `get_document_details`, `get_supplier_rules` — plain functions, unit-tested, no side effect.
- **Act tools, resolved differently than the plan literally described** — and this is the one design decision worth understanding, not just accepting: `components/assistant/pending-changes.ts` (the plan's named "agent proposes → human confirms" mechanism) is built entirely around Univer spreadsheet-cell pre-images; there is no cell to record for "approve this review task" or "push this document to QuickBooks." Rather than force those actions into that shape, **Act tools use confirm-BEFORE-execute instead of the sheet's write-THEN-undo**: `approve_review_tasks`, `reject_review_task`, `set_document_coding`, `create_supplier_rule`, `push_to_accounting` (all in `app/api/ai-chat/route.ts`, backed by `lib/finance/actions.ts`'s `describe*` functions) never mutate anything themselves — each only validates and returns a proposal. `components/assistant/finance-proposal.tsx` renders that proposal as an Accept/Dismiss card in the chat; only Accept calls the real server action (`bulkUpdateReviewTaskStatusAction`, `updateReviewTaskStatusAction`, the new `setDocumentCodingAction`, `createAutomationRuleAction`, `pushDocumentToAccountingAction`). This ordering matters specifically because a push that already reached QuickBooks has no clean undo, unlike a spreadsheet cell — confirming after the fact isn't safe here the way it is for a cell write.
- New surface `"finance-inbox"` in `app/api/ai-chat/route.ts` (no grid, unlike `"sheet"`; unlike `"dictation"` it does get finance tools/persona) and `FINANCE_INBOX_SYSTEM_PROMPT`. The review inbox page (`review-inbox.tsx`) has its own Assistant toggle, mirroring the sheet/dictation pattern.
- **`models/documents.ts`'s new `setDocumentCoding`**: writes ONLY `codingData`, never `reviewedData`/`confidence`/`provenance` (that's `updateDocumentField`'s job); `appliedRuleId` is left untouched so a manual override via the agent never looks like a rule match.
- `createAutomationRule`/`createAutomationRuleAction` gained an `autopublish` param (previously only settable by editing the DB directly) — exposed in `AutomationRuleForm` too.

---

## Live verification this session — what was actually checked, and two real bugs it found

A logged-in browser walkthrough wasn't achievable (see above), so verification instead used: (1) a throwaway script (not committed) exercising the real model/lib functions against the live Docker Postgres — one workspace per industry via `createWorkspaceForUser`, capability resolution, a module disable/re-enable round trip, a document through `applyAutomationRules` + `autopublish`, and the finance-agent `describe*` proposal functions, cleaned up via the real `deleteWorkspace` afterward — all 17 checks passing; and (2) a real browser, once pointed at a correctly-running server (see the tooling gotcha above), confirming the Construction marketing card renders pixel-for-pixel as coded and that signup fails identically (confirming the auth blocker is independent of the worktree issue).

That live run surfaced two **pre-existing** bugs, unrelated to this branch's own feature work but found on its delete path (their cleanup step) — both fixed and committed (`480f572`):

1. **`models/files.ts`'s `deleteFiles`** queried `Document` by `fileId` alone, no `workspaceId` — tripping the workspace-scope guard, which defaults to `"throw"` in production. Every file deletion (and so every workspace deletion) would fail outright in a real deployment. Vitest never caught it because mocked Prisma bypasses the guard extension.
2. **The `document_audit_events` append-only trigger** (`20260822000000_hipaa_audit_hardening`) rejected every `UPDATE` unconditionally — including the table's own two `SET NULL` foreign keys (`document_id`, `actor_id`), which Postgres enforces as an `UPDATE`. Deleting any document or user that ever had an audit event recorded against it — nearly all of them — hit this and failed. New migration (`20260828030000_fix_audit_events_setnull_trigger`) narrows the guard to allow exactly that cascade while still rejecting real tampering. Vitest never caught this either — it only fires against a real trigger, which mocked Prisma has none of.

Also fixed, found while trying to get a dev server running for the browser check: **`next.config.ts`** now pins `turbopack.root` (silences/pre-empts a real multi-lockfile ambiguity warning in worktree setups — though it turned out not to be this session's specific bug, see the tooling gotcha above), and **`node_modules` needed `npm install`** (this worktree's install was missing `@supabase/ssr`, present in `package.json` but absent on disk — likely stale from however this worktree was originally provisioned).

---

## What's left

Nothing deliberately deferred remains from the approved plan. What's genuinely open:

1. **A real logged-in browser walkthrough** — needs a real Supabase project's credentials in `.env`. Once available: create one workspace per industry via `/workspaces/new`, verify seeded worksheets + sidebar nav deltas, toggle a module in the catalog and watch the nav update, run a real invoice through a finance workspace end-to-end (rule applies → check fires → review task → approve → autopublish or manual push), and drive the finance agent through the review inbox's Assistant panel (ask for a summary, propose an approval, Accept it).
2. **Phase 3+ items the plan explicitly designed but did not ask to build this round**: `bank-match`, `expense-approvals`, supplier-statement reconciliation, healthcare/logistics/construction depth beyond the core pack — all still "designed, not built" per the plan's Part 5d.

## Risks (carried forward, still relevant)

1. **RLS list drift** — `WorkspaceModule` ships its policy but not `ENABLE` in Migration B. A future grep test asserting every `WORKSPACE_SCOPED_MODELS` table has a policy would catch this class of drift for good.
2. **Capabilities cache staleness** — module toggles `revalidatePath` both the modules-catalog page and the whole workspace layout; double-check this still holds if the catalog page's caching story changes.
3. **Naming drift** — marketing "Healthcare" vs pack "pathology" vs module "clinical-packs": the mapping is confined to `lib/modules`, keep it that way.
4. **Multi-provider autopublish** — `lib/automation/autopublish.ts` picks the oldest active `IntegrationConnection`; no real policy yet for "which provider" in a multi-connection workspace.
5. **The append-only trigger's scope** — the fix this session narrows the exception to exactly `document_id`/`actor_id` SET NULL; if a future migration adds another nullable FK onto `document_audit_events`, the trigger needs the same treatment or it'll reproduce this bug for that column too.
