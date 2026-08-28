# Handoff — Industry Workspaces + Modules

**Branch:** `claude/industry-workspaces` (this worktree: `extracted-data-search-ai-ed0cdb`)
**Date:** 2026-08-28
**Status:** Part 0 (merge), Part 1 (industry rename), and the first half of Part 2 (module registry + capabilities + schema) are done and verified (not yet committed as of this edit — see "Part 2 progress" below for the exact file list to commit). Parts 2's remaining half (replacing assertMode call sites — there turned out to be none to replace) plus Parts 3–6 are what's left. This doc plus the full plan below is everything a fresh session needs to pick up at Part 3 (item 3 in Part 6's order).

---

## Quick orientation for the next session

- **Read memory first**: `MEMORY.md` has entries for this repo (it's DocuBite, not TaxHacker, despite the folder name), the local dev DB, and prior related work. In particular `worktrees-share-one-prisma-dev-daemon.md` and `local-dev-db-is-docker-pgvector.md`.
- **Local DB**: Docker container `docubite-dev-pg`, pgvector, real port **55432**. This worktree's `.env` has a stale `DATABASE_URL` pointing at port `55433` — **don't trust it**, pass `DATABASE_URL` explicitly on migration commands, e.g.:
  ```
  DATABASE_URL="postgresql://postgres:postgres@localhost:55432/document_inbox" npx prisma migrate deploy
  ```
  Worth fixing `.env` for good in a future session (check the container's actual port with `docker port docubite-dev-pg` since it can drift).
- **Prisma client after any schema.prisma edit**: `npx prisma generate` then `node scripts/fix-next-admin-paths.mjs` (or just `npm run db:generate`, which runs both — this is a required patch for Prisma 7 + next-admin, not optional).
- **Lint changed files explicitly** — repo-wide `npm run lint` OOMs on worktree `.next` dirs.
- **Verification loop that's been used successfully**: `npx tsc --noEmit` → `DB_SCOPE_GUARD=throw npx vitest run` (expect 896 pass as of this handoff, will grow as Part 2+ adds tests) → apply any new migration to the Docker DB with explicit `DATABASE_URL`.
- **Mechanical multi-file renames worked well delegated to a `general-purpose` subagent** with a very explicit prompt (exact rename table, file list, nuances to watch for, verification commands to run itself). Used for the Part 1 rename across 37 files; recommend the same approach for parts of Part 2 (e.g. "replace every `assertMode` call site with `requireModule`" once the registry exists).

---

## What's done

### Part 0 — Merge
`master` (`9b5c4e4`) was the exact merge-base of `claude/docubite-phases-1-2-roadmap-b881ce` (`1082c6d`), so `git merge --ff-only` was a clean fast-forward — no conflicts. Verified `npx tsc --noEmit` clean and `DB_SCOPE_GUARD=throw npm test` at 896/896 (after regenerating the Prisma client, which the merge's new schema.prisma content required). Applied all 39 migrations (including the 9 new ones from that branch) to the Docker dev DB — they were already applied by the time this session checked (shared DB across worktrees). Pushed straight to `origin/master` after user confirmation — **no separate PR**, this was an explicit fast-forward merge per the plan's "Step 0 is the merge" instruction.

### Part 1 — `productMode` → `industry` generalization
Commit `40d5d75` on `claude/industry-workspaces` (branched from the new master, this worktree's branch was renamed from `claude/industry-workspaces-modules-1f57da` to `claude/industry-workspaces` to match).

- New migration `prisma/migrations/20260828000000_generalize_product_mode_to_industry/migration.sql`: renames `workspaces.product_mode` → `industry`, changes default to `'general'`, backfills `clinical`→`healthcare`, and `accounting`→`finance` **only** for workspaces with a row in `integration_connections` (else→`general`). **Applied** to the Docker dev DB already.
- `prisma/schema.prisma`: `Workspace.productMode` field renamed to `industry`, doc comment updated, default `"general"`.
- New `types/industry.ts` replacing `types/product-mode.ts`: `INDUSTRIES = ["finance", "healthcare", "construction", "logistics", "general"]`, `Industry` type, `parseIndustry()`.
- `lib/product-mode.ts` → renamed to `lib/industry.ts` (same `assertMode(industry, required)` mechanism, `ProductModeError`→`IndustryError`). **This is explicitly a placeholder** — the plan calls for `assertMode`/this whole file to be **superseded by `requireModule`** once the Part 2 module registry exists, then deleted.
- `components/workspace/product-mode-toggle.tsx` → renamed to `industry-toggle.tsx`. Still just a **two-way** toggle (finance/healthcare only) — the plan's 5-card industry picker (Part 3) hasn't been built yet. A workspace with `industry` = construction/logistics/general won't show a pressed state in this toggle; that's expected until Part 3 replaces it.
- Every call site of `productMode`/`ProductMode`/`assertMode`/`"accounting"`/`"clinical"` across ~37 files mechanically renamed (see commit `40d5d75` diff for the exact list). Marketing route slugs `/accounting` and `/clinical` were **deliberately left alone** — those are page routes, not the enum, and are a separate later marketing-copy task (Part 4 step 10 in the plan touches marketing but only adds Construction to `lib/solutions.ts`; nobody has scoped renaming `/accounting`→`/finance` as a URL, worth deciding explicitly before doing it since it'd break existing links).
- **Known inconsistency to fix in Part 2/3**: `models/workspaces.ts`'s `createWorkspaceForUser` still defaults `industry: options.industry || "finance"` for the **lazy personal-workspace creation path** (comment there says "there is no onboarding step in that path to ask the question" — a leftover from the old accounting-default reasoning). The plan's guiding decision #3 says **the lazy fallback should default to `"general"`**, not finance. This needs to change as part of Part 3's `/workspaces/new` picker work (once that picker exists, the lazy path might redirect there instead of defaulting silently — see Part 3 point 1 in the plan below: "zero memberships → `redirect(\"/workspaces/new\")`"). Don't forget this — it's real product behavior (every brand-new signup currently becomes a finance workspace, silently).
- Verified: `npx tsc --noEmit` clean, `DB_SCOPE_GUARD=throw npx vitest run` → 896/896 pass, migration applied to Docker DB.

### Useful reconnaissance done during Part 2 scoping (not yet acted on)
- `lib/domains/index.ts` is the pattern to mirror for `lib/modules/index.ts` — a flat array-based registry (`DOMAIN_ADAPTERS`) with pure lookup functions (`findDomainAdapter`, `extractionDomainPacks`), no database. Read it in full before writing the module registry; it already has the exact shape the plan asks for ("one file + one line" to register something new).
- `lib/workspace-scope.ts` is the pattern for registering `WorkspaceModule` in `WORKSPACE_SCOPED_MODELS` (Part 1, Migration B in the plan) — it's a `Set<string>` of Prisma model names with a big doc comment explaining what's deliberately excluded; just add `"WorkspaceModule"` to the set with a one-line comment, same style as the existing entries (e.g. `// Accounting core (WP12).` above `"DocumentCheckResult"`).
- `models/workspaces.ts` has the `cache()`-wrapped-vs-not pattern to follow for `getWorkspaceCapabilities` (Part 2 in the plan): `getWorkspaceMembership` is `cache()`-wrapped (safe to reuse within a request because it's read-only and consulted repeatedly), but anything consulted **immediately before a mutation** (like `isWorkspaceLimitExempt`) is deliberately **not** cached to avoid serving a stale snapshot mid-request. `getWorkspaceCapabilities` should be `cache()`-wrapped like `getWorkspaceMembership` (module toggles are rare admin actions, not something racing a mutation in the same request) — but reread this section of `models/workspaces.ts` (lines ~25-29, ~46-51) before deciding, it explains the reasoning in the code itself.
- `setIndustry` (formerly `setProductMode`, in `models/workspaces.ts` ~line 151) already has the lock-once-seeded + hipaaMode-coupling logic the plan's guiding decision #5 describes. It takes `{ workspaceId, actorId, mode: Industry }` — note the param is still named `mode` even though the type is `Industry` now; harmless but a little inconsistent, rename to `industry` if touching this function again.
- `DEFAULT_DOCUMENT_TEMPLATES` (in `lib/document-templates.ts`) is currently just `= FINANCE_TEMPLATES` — i.e. **every** new file today gets finance's 4 templates seeded regardless of workspace industry. This is exactly what Part 2's `lib/modules/seeds.ts` (industry → template list) needs to replace: `createFile` in `models/files.ts` (~line 51-77) takes an optional `templates` param already, so seeding is just a matter of resolving the right template list by industry and passing it in from `createWorkspaceForUser`/`createTeamWorkspace`, rather than changing `createFile`'s own signature.

### Part 2 progress (this session) — module registry + capabilities

Built, verified (`tsc` clean, `917/917` vitest incl. 21 new tests, migration applied to Docker `docubite-dev-pg`, changed files linted), **not yet committed**:

- **Migration B applied**: `prisma/migrations/20260828010000_add_workspace_modules/migration.sql` — `workspace_modules` table (workspaceId, moduleKey, status, source, requestedById, note), unique on `(workspaceId, moduleKey)`, same inert-RLS-policy pattern as `20260826010000_add_integration_push`. `WorkspaceModule` added to `prisma/schema.prisma` (relations on `Workspace.modules` and `User.requestedWorkspaceModules @relation("ModuleRequester")`) and to `WORKSPACE_SCOPED_MODELS` in `lib/workspace-scope.ts`.
- **`lib/modules/index.ts`**: the registry — `ModuleDefinition`, `MODULES` (all 17 rows from the launch-modules table below, including `construction-packs` even though its domain pack doesn't exist yet), `findModule`, `modulesForIndustry`, `INDUSTRIES`.
- **`lib/modules/capabilities.ts`**: `resolveModules(industry, overrides, deployment, plan)` — pure, unit-tested matrix (tier gating, override semantics, cross-industry override ignored, requiresConfig/requiresPlanFlag drops). `getWorkspaceCapabilities(workspaceId)` — `cache()`-wrapped, reads `config.asr/integrations/embeddings.enabled` (lib/config.ts) for deployment gates and `getWorkspacePlan(...).integrations` for the plan flag. `requireModule(workspaceId, key)` throws `ModuleNotEnabledError`.
- **`models/modules.ts`**: `setModuleState` (upsert, refuses an unknown module key), `getWorkspaceModuleOverrides`. No auth inside — same untrusted-caller-does-the-auth convention as `models/workspaces.ts`; the server action wrapping this (owner-only enable/disable, any member may request) is Part 3's modules-catalog work, not built yet.
- **`lib/modules/seeds.ts`**: `seedTemplatesForIndustry(industry)` — finance/healthcare/logistics/general fully wired to real domain packs; **construction currently falls back to just the generic template** (`lib/domains/construction.ts` doesn't exist yet — swap the TODO'd line once Part 3 builds it). **Not called from anywhere yet** — `createWorkspaceForUser`/`createTeamWorkspace` in `models/workspaces.ts` still pass no `templates` (i.e. still get bare `DEFAULT_DOCUMENT_TEMPLATES` = finance's set) — wiring this in is explicitly Part 3 work, see "Known inconsistency" note below which is still unresolved.
- **`lib/modules/personas.ts`**: `personaAddendumForIndustry` stub with finance copy only. **Not wired into `app/api/ai-chat/route.ts` yet** — that's Part 4.
- **Tests**: `lib/modules/index.test.ts` (registry invariants, mirrors `lib/domains/index.test.ts`'s style), `lib/modules/capabilities.test.ts` (the `resolveModules` matrix). 21 new tests, all passing.
- **What did NOT happen**: `assertMode` (`lib/industry.ts`) has **no real call sites** in production code — grepped for `assertMode(` and found only its own test file. The gates the plan describes (`workspace.industry !== "healthcare"` in `lib/asr/gating.ts`, `dictation-actions.ts`, `actions.ts`) are ad-hoc string comparisons, not calls to `assertMode` — so "replace every assertMode call site" turned out to be a non-task. Those ad-hoc checks still need to become `requireModule(workspaceId, "dictation")` etc. — that's still Part 4 work, just note it's not literally an `assertMode` replacement. `lib/industry.ts` has NOT been deleted (nothing forces that yet; do it once Part 4 removes the ad-hoc healthcare checks).
- **Left uncommitted on purpose**: verify this all still looks right in a fresh read before committing — nothing here depends on anything else being mid-flight, so it's safe to commit as-is, but hasn't been to keep this session's diff reviewable as one unit if you want to split it (e.g. schema+migration as one commit, registry+capabilities+tests as another).

---

## What's next — Parts 2 through 6, verbatim from the approved plan

Everything below is the plan as approved by the user before this session started. Follow it as-is unless something discovered while implementing contradicts it — in which case, flag the contradiction to the user rather than silently deviating (the "Known inconsistency" note above is exactly that kind of flag).

### User decisions already made (don't re-litigate)
1. Scope = architecture + finance depth in one round.
2. Existing workspaces backfill as **General** (with carve-outs — see Migration A, already applied).
3. Modules are strictly **industry-scoped** (+ a shared core) — no cross-industry borrowing.
4. Finance vertical is agent-first.
5. Merge phases-1-2 to master first (**done**), then build the industry work from updated master (**in progress, this branch**).

### Part 1 — Schema (Migration B and C — NOT YET WRITTEN)

Migration A is done. Still needed:

**Migration B — `add_workspace_modules`**
```prisma
model WorkspaceModule {
  id            String    @id @default(uuid()) @db.Uuid
  workspaceId   String    @map("workspace_id") @db.Uuid
  moduleKey     String    @map("module_key")
  status        String    // "enabled" | "disabled" | "requested"
  source        String    @default("user")  // "default" | "user" | "admin"
  requestedById String?   @map("requested_by_id") @db.Uuid
  note          String?
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")
  workspace     Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  requestedBy   User?     @relation("ModuleRequester", fields: [requestedById], references: [id], onDelete: SetNull)
  @@unique([workspaceId, moduleKey])
  @@map("workspace_modules")
}
```
Include the RLS policy `DO $$` block (pattern of `20260826010000_add_integration_push`), inert until the enable-RLS rollout; SQL comment noting the enable-list must add this table. Register `"WorkspaceModule"` in `WORKSPACE_SCOPED_MODELS` (`lib/workspace-scope.ts`).

No new `SupplierRule` table — the existing `AutomationRule` (`models/automation-rules.ts`, `lib/automation/rules.ts`) already covers matcher/actions/confidence; extend it instead (see Part 5b, Migration C: adds `autopublish Boolean @default(false)`).

### Part 2 — Module registry (`lib/modules/`, new)

**`lib/modules/index.ts`** — pure registry, mirrors `lib/domains/index.ts`:
```ts
import type { Industry } from "@/types/industry"
export type ModuleDefinition = {
  key: string; name: string; description: string
  industry: Industry | "core"
  tier: "always" | "default" | "optional"   // always = not toggleable (all core modules)
  activation: "enable" | "request"
  navItems?: { href: string; label: string; icon: string }[]
  requiresConfig?: "asr" | "integrations" | "embeddings"
  requiresPlanFlag?: "integrations"
  pushableTemplateCodes?: string[]
  domainPack?: "finance" | "pathology" | "logistics" | "construction"
  optionalTemplateCodes?: string[]          // e.g. bank_statement pack-ons
}
export const MODULES: ModuleDefinition[] = [...]
export const modulesForIndustry = (i: Industry) => MODULES.filter(m => m.industry === "core" || m.industry === i)
export const INDUSTRIES: { key: Industry; label: string; description: string }[] = [...]
```

**Launch modules table** (mapping the phases-1-2 branch's booleans into the registry):

| key | industry | tier | replaces / adds |
|---|---|---|---|
| `documents`, `sheets`, `search`, `assistant`, `reports` | core | always | shared baseline, "Included" in catalog |
| `review-queue` | finance | default | branch's `reviewQueueEnabled` (`/review`, ReviewTask) |
| `supplier-rules` | finance | default | branch's `rulesEnabled` (`settings/rules`, AutomationRule) |
| `document-checks` | finance | default | the 5 deterministic checks running in the worker |
| `tax-profiles` | finance | default | branch's `taxSettingsEnabled` (`settings/tax`) |
| `accounting-push` | finance | default | QBO/Xero push; `requiresConfig:"integrations"`, `requiresPlanFlag:"integrations"`, `pushableTemplateCodes:["invoice","receipt","expense_receipt"]` |
| `finance-agent` | finance | default | NEW: agent persona + tool bundle (Part 5) |
| `statement-packs` | finance | optional | `optionalTemplateCodes:["bank_statement","purchase_order","remittance_advice","supplier_statement"]` — one-click adds the branch's optional finance templates |
| `expense-approvals` | finance | optional | phase 3, catalog "coming soon" |
| `bank-match` | finance | optional | phase 3 |
| `dictation` | healthcare | default | branch's clinical-only dictation gate; `requiresConfig:"asr"` |
| `clinical-packs` | healthcare | default | `domainPack:"pathology"` |
| `hipaa-controls` | healthcare | optional | `activation:"request"`; wraps hipaaMode/BAA surface |
| `logistics-packs` | logistics | default | `domainPack:"logistics"` |
| `construction-packs` | construction | default | new pack (Part 2c below) |

General workspaces get core only. Future industry depth = new rows under that industry.

**`lib/modules/capabilities.ts`** — the single gate:
- Pure `resolveModules(industry, overrides, config, plan)` (unit-testable): `modulesForIndustry` with `always`+`default` on; apply overrides (`enabled` turns on this industry's optionals; `disabled` turns off non-`always`; `requested` adds nothing; overrides for other industries' modules ignored); drop modules failing `requiresConfig`/`requiresPlanFlag` (reuse `getWorkspacePlan(...).integrations`, same semantics as `workspaceIntegrationsPlanEnabled` in `models/integrations.ts`).
- `getWorkspaceCapabilities(workspaceId)` — React `cache()`-wrapped (like `getWorkspaceMembership`); returns `{ industry, enabled: Set, has(key), pushableTemplateCodes }`.
- `requireModule(workspaceId, key)` — throws `module_not_enabled`; **supersedes `assertMode`** — replace every `assertMode(mode, "finance")`/`assertMode(mode, "healthcare")` call site with the specific module (`requireModule(ws, "review-queue")` etc.), and the healthcare dictation gate with `requireModule(ws, "dictation")`. Delete `lib/industry.ts` when no call sites remain.
- Mutations in new `models/modules.ts` (`setModuleState`); server actions do auth (`requireWorkspaceRole` owner for enable/disable; any member may request) + `revalidatePath`.

**`lib/modules/seeds.ts` + new `lib/domains/construction.ts`**
- Seeds per industry (passed to `createFile`, `models/files.ts`): finance → `FINANCE_TEMPLATES` (now 4 incl. expense_receipt); healthcare → `PATHOLOGY_TEMPLATES` + generic; logistics → `LOGISTICS_TEMPLATES` + generic; construction → `CONSTRUCTION_TEMPLATES` + generic; general → invoice/receipt/generic (today's baseline).
- New construction pack, pattern-parity with `lib/domains/logistics.ts`: `subcontractor_invoice` (multiRow; contractor, project/job code, invoice no, period, retention, total), `lien_waiver` (type conditional/unconditional, through-date, amount, claimant, property), `delivery_ticket` (multiRow; supplier, ticket no, date, material/qty/unit), `timesheet` (multiRow; worker, date, hours, cost code), `change_order` (CO number, description, cost/schedule delta, approval status) + `CONSTRUCTION_BIAS_TERMS`. Register: extend the `domain` union in `lib/domains/index.ts`'s `DomainAdapter` type, one `DOMAIN_ADAPTERS` line, one `EXTRACTION_PACK_LABELS` entry.

### Part 3 — Industry choice UX

1. **Picker for the personal path** (closes the gap noted above) — new `app/(app)/workspaces/new/page.tsx`: five selectable cards (icon, one-line promise, chips naming default modules), keyboard-navigable, name field prefilled, live "what you'll get" panel (seeded worksheets + nav items), "Not sure? Start General" escape hatch. `app/(app)/workspaces/page.tsx`: zero memberships → `redirect("/workspaces/new")`; invited members (membership exists) skip it. Keep `getOrCreateWorkspaceForUser` as safety net (industry `general`, **not** `finance` — fix the inconsistency noted above here).
2. **Team form** — `components/workspace/industry-toggle.tsx` (renamed from `product-mode-toggle.tsx` in Part 1) upgrades from its current 2-mode toggle to the same 5-industry card set (shared component with `/workspaces/new`).
3. **`createWorkspaceForUser` / `createTeamWorkspace`** (`models/workspaces.ts`): already take an `industry` param (Part 1 rename) — wire in `seedTemplatesForIndustry` (from `lib/modules/seeds.ts`) to the `createFile` call instead of the current bare `DEFAULT_DOCUMENT_TEMPLATES`/no-param call. `setIndustry` keeps its lock-once-seeded + hipaaMode-coupling semantics (already correct from Part 1, just rename the `mode` param to `industry` while touching this).
4. **Modules catalog** — new `app/(app)/workspaces/[workspaceId]/(chrome)/settings/modules/page.tsx`, showing only core + this industry's modules: *Included* (always + enabled defaults, disable toggles on defaults), *Optional* (Enable, or Request for request-tier → `requested` row + badge, shows who/when). Owners toggle; members read-only + Request. Reads like a product page (card per module: icon, description, "what it adds"), instant-feedback toggles, "hides features, never deletes data" copy.

### Part 4 — Wiring

1. **Layout** `app/(app)/workspaces/[workspaceId]/layout.tsx`: resolve capabilities once; pass a serializable enabled-keys array to `Sidebar`, replacing the five ad-hoc booleans (`dictationEnabled`, `integrationsEnabled`, `taxSettingsEnabled`, `reviewQueueEnabled`, `rulesEnabled`) it currently takes.
2. **Sidebar** `components/shell/sidebar.tsx`: base items + `navItems` of enabled modules (icon-name → lucide map), keeping the existing `...(cond ? [item] : [])` shape and sheet-page hiding.
3. **Gates**: every `assertMode` site (see Part 1's rename, all still using the old two-value mechanism) → `requireModule` (review pages/actions, rules page/actions, tax page/actions, dictation pages/actions/stream route). Push actions/cards read `caps.pushableTemplateCodes` + `requireModule("accounting-push")`. `statement-packs` enablement materializes its `optionalTemplateCodes` worksheets via the existing `addDomainPackToFile` mechanism (check `models/files.ts` / the templates settings page for the current name of this — it's referenced from `lib/domains/index.ts`'s `extractionDomainPacks()`).
4. **Assistant persona** `app/api/ai-chat/route.ts`: keep sheet/dictation base prompts; append an industry addendum from new `lib/modules/personas.ts` (finance at launch, gated on `finance-agent`).
5. **Marketing** `lib/solutions.ts`: add Construction + Logistics-consistent entries to `INDUSTRIES` (construction copy mirrors the pack); leave `/accounting`+`/clinical` marketing pages as-is this round.

### Part 5 — Finance vertical: Dext-style surface + agent-first depth

**5a. Costs-inbox experience** (evolve `/review`, module `review-queue`)
- Status tabs with live counts (To review / Reviewed / Published / Failed), URL-persisted. "Published" derives from completed `IntegrationPush`; reviewed = approved ReviewTask/`reviewedAt`.
- Dense triage rows: supplier, date, amount, confidence dot, chips from `DocumentCheckResult` (Duplicate / Arithmetic / Tax / Gap) and "Rule applied" (`appliedRuleId`) — each chip explainable (click → why: matching doc, failing sum, rule).
- Split view: row → right-pane document preview (existing `DocumentPreview`) + fields; `j/k` navigate, `e` approve, `p` push; multi-select + sticky bulk bar; optimistic updates with undo toasts; per-row push progress from IntegrationPush statuses.
- Empty states that teach (upload dropzone, connect-QBO/Xero card when unconnected, three-step explainer for new workspaces).

**5b. Supplier rules → autopublish** (extend `AutomationRule`, no new table)
- Migration C: add `autopublish Boolean @default(false)` to `AutomationRule`. On review approval (and on rule application for high-confidence docs where `requireReview` is false), if the matched rule has `autopublish` + an active `IntegrationConnection`, enqueue via the existing `IntegrationPush` path.
- "Create rule from this document" affordance on document detail + review detail (prefills matcher from the extracted supplier).

**5c. Finance agent** (agent-first; module `finance-agent`)
Capabilities live once in `lib/finance/` as plain functions consumed by both server actions and ai-chat tools:
- **Read tools**: `get_inbox_summary` (counts per status, failing checks, unmatched-supplier list), `find_supplier_documents`, `get_document_details` (fields + confidence + check results + workflow state), `get_supplier_rules`.
- **Act tools** (agent proposes → human confirms via the existing pending-changes bar `components/assistant/pending-changes.ts`): `approve_review_tasks`, `reject_review_task`, `set_document_coding` (writes `codingData`, same shape rules produce), `create_supplier_rule` ("always code Uber to Travel, autopublish"), `push_to_accounting`.
- Every tool calls `requireModule("finance-agent")` plus the gate of the capability it touches (push tools also need `accounting-push`). Assistant panel opens in-context over the inbox with these tools active.
- This is the template for later industry agents: persona addendum + tool bundle keyed to the industry's modules — no ai-chat rework to add one.

**5d. Phase 3+ (designed, not built)**: `bank-match` (statement-line ↔ receipt matching, StatementMatch table — statement extraction already exists via `statement-packs`), `expense-approvals` (ExpenseClaim submit→approve→publish), supplier-statement reconciliation view, healthcare/logistics/construction depth via the same module recipe.

### Part 5b — UX standards (best-in-class, seamless)

Native to the existing shadcn/Tailwind language (see the sidebar's stone/emerald palette). Across all new surfaces: keyboard-first interactions, optimistic updates with undo, skeletons matching final layout (no spinner-then-shift), responsive to tablet width, dark-mode parity, empty states that teach. Gated pages where the module exists but is off render a designed "This module isn't enabled — ask your workspace owner" screen deep-linking the catalog, not a bare 404 (bare `notFound()` stays for modules outside the workspace's industry).

### Part 6 — Implementation order

0. ~~Merge phases-1-2 → master, branch off.~~ **DONE**
1. ~~Migration A (industry rename/backfill) + `types/industry.ts` + fix all tsc fallout.~~ **DONE**
2. Migration B (WorkspaceModule) + `lib/workspace-scope.ts`; `lib/modules/` registry/capabilities/seeds/personas + `models/modules.ts` + tests; replace `assertMode` sites with `requireModule`. **← START HERE**
3. Construction pack + registration; `lib/modules/seeds.ts` wired into workspace creation.
4. Pickers: `/workspaces/new`, upgraded team form, `/workspaces` redirect.
5. Sidebar/layout capabilities wiring; statement-packs materialization.
6. Modules catalog page + actions.
7. Costs-inbox evolution of `/review` (tabs, chips, split view, keyboard, bulk).
8. Migration C (`AutomationRule.autopublish`) + autopublish path + create-rule-from-document.
9. Finance agent: `lib/finance/` functions, ai-chat tools, persona addendum, pending-changes integration.
10. Marketing: Construction in `lib/solutions.ts`.

## Verification (for every future step)

- **Unit (vitest — keep tests green, run under `DB_SCOPE_GUARD=throw`)**: registry invariants test mirroring `lib/domains/index.test.ts` (unique keys, industry values valid, nav hrefs); `resolveModules` matrix (industry scoping, overrides, always un-disableable, config/plan gates, cross-industry override ignored); construction pack round-trip; autopublish decision logic; agent tool gating.
- **Static**: `npx tsc --noEmit`; `npm run build`; eslint changed files only (repo-wide lint OOMs on worktree `.next`).
- **Migrations**: `prisma migrate deploy` against Docker `docubite-dev-pg` (55432, explicit `DATABASE_URL`); verify backfill/new-migration behavior with a seeded DB where relevant.
- **Live browser** (dev server; `rm -rf .next` if `(chrome)` routes 404 — known Turbopack issue): create one workspace per industry via the new picker → verify seeded worksheets + sidebar deltas; direct-URL a finance page from a healthcare workspace (bare 404) and a disabled-optional page from finance (designed off-screen); toggle a module and watch nav update; run a real invoice through a finance workspace → rule applies, check fires, review task appears, approve, push card; ask the finance agent for an inbox summary and to propose an approval (lands in pending-changes bar).

## Risks (from the original plan, still relevant)

1. **Rename fallout**: any further `product_mode`/`industry` touch points should stay mechanical, tsc-guided, its own commit before behavior changes — same discipline as Part 1.
2. **RLS list drift** — `WorkspaceModule` ships its policy but not `ENABLE` in Migration B; SQL comment + checklist; later a grep test asserting every `WORKSPACE_SCOPED_MODELS` table has a policy.
3. **Capabilities cache staleness** — module toggles must `revalidatePath` the workspace subtree.
4. **Naming drift** — marketing "Healthcare" vs pack "pathology": keep the mapping confined to `lib/modules`.
