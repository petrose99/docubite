# Handoff — Industry Workspaces + Modules

**Branch:** `claude/industry-workspaces` (this worktree: `extracted-data-search-ai-ed0cdb`)
**Date:** 2026-08-28
**Status:** Parts 0–6 of the approved plan are all substantively built and committed (commits `d9d1b73`→`976fa9f`), with two deliberately-deferred pieces left for a future session — see "What's left" below. Everything is `tsc`-clean, the full vitest suite passes, and every new migration is applied to the Docker dev DB.

---

## Quick orientation for the next session

- **Read memory first**: `MEMORY.md` has entries for this repo (it's DocuBite, not TaxHacker, despite the folder name), the local dev DB, and prior related work. In particular `worktrees-share-one-prisma-dev-daemon.md` and `local-dev-db-is-docker-pgvector.md`.
- **Local DB**: Docker container `docubite-dev-pg`, pgvector, real port **55432**. This worktree's `.env` has a stale `DATABASE_URL` pointing at port `55433` — **don't trust it**, pass `DATABASE_URL` explicitly:
  ```
  DATABASE_URL="postgresql://postgres:postgres@localhost:55432/document_inbox" npx prisma migrate deploy
  ```
  This also affects `npm run build` (its `prisma migrate deploy` prestep reads `.env` and fails) — run `next build` directly with `DATABASE_URL` set instead, or fix `.env` for good first (check the container's actual port with `docker port docubite-dev-pg`, it can drift).
- **Prisma client after any schema.prisma edit**: `npm run db:generate` (runs `prisma generate` + the required Prisma 7/next-admin path patch).
- **Lint changed files explicitly** — repo-wide `npm run lint` OOMs on worktree `.next` dirs.
- **Verification loop used throughout this build**: `npx tsc --noEmit` → `DB_SCOPE_GUARD=throw npx vitest run` (926/926 as of this handoff) → apply any new migration to the Docker DB with explicit `DATABASE_URL` → lint the changed files.
- **This session was entered mid-branch from a different worktree** (`marketing-ui-audio-review-e977c4`, on an unrelated branch) via `EnterWorktree({path: ...})` — the handoff doc and branch live here, not wherever a fresh session happens to launch. Check `git log --oneline -5` and `git branch --show-current` before assuming you're on the right branch.

---

## What's done (commits `d9d1b73` through `976fa9f`)

### Part 0 — Merge, Part 1 — `productMode` → `industry` rename
Unchanged from the prior handoff: clean fast-forward merge to master, migration + schema + `types/industry.ts` + the mechanical rename across ~37 files. See `git show 40d5d75` / `git show d9d1b73` for the full detail if needed — not repeated here.

### Part 2 — Module registry + capabilities (`b2f32f1`, `69e0ff5`)
- **Migration B** (`20260828010000_add_workspace_modules`): `WorkspaceModule` table (workspaceId, moduleKey, status, source, requestedById, note), unique on `(workspaceId, moduleKey)`, inert RLS policy matching `20260826010000_add_integration_push`'s pattern. Registered in `WORKSPACE_SCOPED_MODELS` (`lib/workspace-scope.ts`).
- **`lib/modules/index.ts`**: `ModuleDefinition`, `MODULES` (17 rows — core always-on baseline + finance/healthcare/logistics/construction), `findModule`, `modulesForIndustry`, `INDUSTRIES`.
- **`lib/modules/capabilities.ts`**: `resolveModules(industry, overrides, deployment, plan)` (pure, unit-tested), `getWorkspaceCapabilities(workspaceId)` (`cache()`-wrapped, returns `{ industry, enabled, has, pushableTemplateCodes }`), `requireModule(workspaceId, key)`.
- **`models/modules.ts`**: `setModuleState`, `getWorkspaceModuleOverrides` (includes the requester for the catalog's "Requested by" badge).
- **`lib/industry.ts` (assertMode) deleted** — it turned out to have no real call sites outside its own test; the ad-hoc `workspace.industry !== "..."` checks scattered through the app (not literal `assertMode` calls) are what actually needed replacing — see Part 4 below.

### Part 3 — Construction pack, seeds, industry pickers (`69e0ff5`, `84f6e0c`)
- **`lib/domains/construction.ts`**: 5 templates (subcontractor_invoice, lien_waiver, delivery_ticket, timesheet, change_order) + bias terms, registered in `lib/domains/index.ts`.
- **`lib/modules/seeds.ts`**'s `seedTemplatesForIndustry` now fully wired to real packs for every industry, and **is actually called** from `createWorkspaceForUser` (`models/workspaces.ts`) — no more bare `DEFAULT_DOCUMENT_TEMPLATES`.
- **Fixed the flagged inconsistency**: the lazy personal-workspace path now defaults `industry` to `"general"`, not `"finance"`.
- **`components/workspace/industry-picker.tsx`**: the shared 5-industry card set (with module chips), used by `components/workspace/industry-toggle.tsx` (upgraded from its old 2-way toggle), `components/workspace/team-workspace-form.tsx`, and the new `/workspaces/new` page.
- **`app/(app)/workspaces/new/`**: a brand-new user's first-workspace picker. `app/(app)/workspaces/page.tsx` now redirects a zero-membership user there instead of silently creating a general workspace.

### Part 4 — Sidebar/layout wiring, gates, persona, marketing (`69e0ff5`, `d2704c8`)
- **Sidebar/layout**: the five ad-hoc booleans (`dictationEnabled`, `integrationsEnabled`, `taxSettingsEnabled`, `reviewQueueEnabled`, `rulesEnabled`) replaced with `enabledModuleKeys: string[]` from `getWorkspaceCapabilities`, rendered via each `ModuleDefinition.navItems`.
- **Every ad-hoc `workspace.industry !== "finance"/"healthcare"` gate** (review/rules/tax pages+actions, dictation pages/actions/stream route) replaced with `getWorkspaceCapabilities(...).has("<module>")`.
- **Assistant persona**: `app/api/ai-chat/route.ts` appends `lib/modules/personas.ts`'s finance addendum when `finance-agent` is enabled (sheet only, never on the dictation assistant).
- **Marketing**: added a Construction entry to `lib/solutions.ts`'s `INDUSTRIES` list, mirroring the construction pack's documents.

### Part 5 — Modules catalog, statement-packs materialization (`84f6e0c`, `d2704c8`)
- **Modules catalog**: `app/(app)/workspaces/[workspaceId]/(chrome)/settings/modules/`, `module-actions.ts` (`enableModuleAction`/`disableModuleAction` owner-only, `requestModuleAction` any member), `components/workspace/module-row.tsx`. Linked from the sidebar.
- **`models/files.ts`'s `addDomainPackToWorkspace`**: enabling an optional module with a `domainPack` (statement-packs today) materializes its worksheets into every existing file immediately, via `enableModuleAction`.

### Part 5a/5b — Costs-inbox chips, autopublish, create-rule (`9343dc7`, `d2704c8`, `976fa9f`)
- **Review queue chips**: `listReviewTasks` now includes each document's confidence map, applied rule name, and failing/warning check results. The table shows a confidence dot (lowest field score), a "Rule applied" chip, and per-check chips (Duplicate/Arithmetic/Balance/Gap/Tax/Resubmission), plus a real empty state explaining what populates the queue.
- **Migration C** (`20260828020000_add_automation_rule_autopublish`): `AutomationRule.autopublish` (default false). **`lib/automation/autopublish.ts`**: pushes a rule-coded document to the workspace's connected accounting provider automatically when the matched rule says to — wired into `applyAutomationRules` (no review needed) and `review-actions.ts`'s approve/bulk-approve actions (review needed, then approved).
- **"Create a rule from this document"**: on both the document detail page and the review-task detail page — owner + `supplier-rules` enabled + a vendor/merchant value gets a collapsible `AutomationRuleForm` prefilled with that supplier.
- **Consolidated three separate hardcoded pushable-template-code sets** (`integration-push-actions.ts`, the document detail page, `autopublish.ts`) into one: `capabilities.pushableTemplateCodes` from the `accounting-push` module definition — this also fixed a real drift (`expense_receipt` was pushable in the registry but missing from two of the three hardcoded copies). The document detail page's `canPush` now reads `capabilities.has("accounting-push")` instead of three separate config/plan checks.

### Part 5c — Finance agent, read half (`1d1999e`)
- **`lib/finance/inbox.ts`**: `getInboxSummary`, `findSupplierDocuments`, `getDocumentDetails`, `getSupplierRules` — plain read functions, unit-tested.
- Registered as ai-chat tools (`get_inbox_summary`, `find_supplier_documents`, `get_document_details`, `get_supplier_rules`), gated on the `finance-agent` module. All read-only, so none need a confirmation flow.
- `personas.ts`'s finance addendum rewritten to describe **only** these four read tools, and explicitly tells the model it cannot yet approve/reject/code/create-a-rule/push — see "What's left" for why.

---

## What's left

Two pieces were deliberately deferred rather than rushed. Both are real, scoped work — not vague TODOs.

### 1. Costs-inbox split view + keyboard nav (Part 5a, remainder)
Still open from the plan's costs-inbox description: a right-pane split view (row → `DocumentPreview` + fields, reusing the existing component), `j`/`k` row navigation, `e` to approve, `p` to push, a sticky multi-select bulk bar (today's bulk approve/reject already exists as a simple banner, not sticky), and optimistic updates with undo toasts. What's already built (status tabs, confidence/rule/check chips, basic bulk approve/reject, a real empty state) covers the "read and understand the queue" half; this remainder is the "fast keyboard-driven triage" half — a genuine UI feature, not a quick follow-on. `components/workspace/review-queue-table.tsx` and `app/(app)/workspaces/[workspaceId]/review/page.tsx` are where it'd land; `app/(app)/workspaces/[workspaceId]/review/[taskId]/page.tsx` already has most of the pieces a split-view pane would reuse (preview, fields, status controls).

### 2. Finance agent act tools + pending-changes integration (Part 5c, remainder)
The plan's "Act tools" — `approve_review_tasks`, `reject_review_task`, `set_document_coding`, `create_supplier_rule`, `push_to_accounting` — are not built. The reason isn't effort, it's a real architectural mismatch worth flagging explicitly: `components/assistant/pending-changes.ts` (the "agent proposes → human confirms" mechanism the plan names) is built entirely around Univer spreadsheet cell pre-images (`PendingChange = { kind: "cell" | "column", ... }`, `undo()`/`accept()` operate on `sheet.getRange(...)`). There is no cell to record a pre-image for "approve this review task" or "push this document" — extending it correctly means designing a new `PendingChange` kind (or a parallel mechanism) with its own undo semantics for non-cell actions, plus updating `pending-changes-bar.tsx`'s UI to render it. That's a genuine design decision (what does "undo" mean for a push that already reached QuickBooks?), not a mechanical wire-up, so it wasn't attempted here rather than risk a half-correct confirmation flow around real side effects (approving tasks, pushing bills externally). `lib/finance/inbox.ts` is the pattern to extend with the corresponding write functions once that design is settled — e.g. `lib/finance/actions.ts` with the same "plain function, consumed by both a tool and a server action" shape.

Both are called out here rather than attempted at reduced quality — pick either up as its own focused session.

---

## Verification

- **Static**: `npx tsc --noEmit` (clean) — `npm run build`'s own `prisma migrate deploy` prestep fails against the stale `.env` `DATABASE_URL`; run `DATABASE_URL="postgresql://postgres:postgres@localhost:55432/document_inbox" npx next build` directly instead, or fix `.env` first.
- **Unit**: `DB_SCOPE_GUARD=throw npx vitest run` → 926/926 as of `976fa9f`. Registry invariants (`lib/modules/index.test.ts`), `resolveModules` matrix (`lib/modules/capabilities.test.ts`), seed lists (`lib/modules/seeds.test.ts`), finance inbox reads (`lib/finance/inbox.test.ts`) all covered.
- **Migrations**: all 3 new migrations (Migration A/B/C) applied to Docker `docubite-dev-pg` (55432, explicit `DATABASE_URL`).
- **Not done this session**: a live-browser walkthrough (create one workspace per industry via the picker, toggle a module and watch the nav update, run a real invoice through a finance workspace end-to-end, ask the finance agent for an inbox summary). Worth doing before this branch ships, especially the picker → seeded-file → sidebar-nav path and the modules catalog's owner/member permission split, since neither has been exercised outside of `tsc`/vitest.

## Risks (carried forward, still relevant)

1. **RLS list drift** — `WorkspaceModule` ships its policy but not `ENABLE` in Migration B; same for the pattern it copied. A future grep test asserting every `WORKSPACE_SCOPED_MODELS` table has a policy would catch this class of drift for good.
2. **Capabilities cache staleness** — module toggles `revalidatePath` both the modules-catalog page and the whole workspace layout (`revalidateWorkspaceLayout`), so the sidebar updates; double-check this still holds if the catalog page's caching story changes.
3. **Naming drift** — marketing "Healthcare" vs pack "pathology" vs module "clinical-packs": the mapping is confined to `lib/modules`, keep it that way rather than letting a marketing term leak into a module key or vice versa.
4. **Multi-provider autopublish** — `lib/automation/autopublish.ts` picks the oldest active `IntegrationConnection` when a workspace has more than one; there's no real policy yet for "which provider" in a multi-connection workspace, since multi-provider push isn't a supported scenario elsewhere either.
