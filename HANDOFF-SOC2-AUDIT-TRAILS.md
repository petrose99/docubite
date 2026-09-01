# Handoff — SOC 2 audit trail coverage

**Branch:** `claude/soc2-audit-trails-6aba7e` (worktree `extracted-data-search-ai-ed0cdb`)
**Merged:** 2026-09-01, PR [#23](https://github.com/petrose99/docubite/pull/23), commit `fad0943`, into `master`
**Status:** **Done and merged.** `npx tsc --noEmit` clean (pre-existing `models/bigcapital.ts` / `admin-next` Prisma-client errors are unrelated — see below), `npx vitest run` 1090/1090 passing, and every new event type verified **live** against a real self-hosted BigCapital instance in the browser (not just unit tests).

---

## What this delivers

DocuBite already had `DocumentAuditEvent` (workspace-scoped, append-only, IP/UA/outcome) and `AdminAuditEvent` (platform-level) tables with never-throw helpers (`recordDocumentAudit`, `recordSystemAudit`, `auditEventData` in `lib/audit.ts`). A gap analysis found ~25 SOC 2-critical actions writing no audit row at all. This closes that gap and adds a filtering/export UI on top of it.

### New event types (25 total)

**Workspace lifecycle / membership** (`models/workspaces.ts`): `workspace_created`, `workspace_renamed`, `workspace_deleted` (→ `AdminAuditEvent`, written *before* the cascading delete — see decisions below), `workspace_member_role_changed`, `workspace_ownership_transferred`, `invitation_created`, `invitation_revoked`, `invitation_accepted`.

**API keys / webhooks** (`integrations-actions.ts`): `api_key_created`, `api_key_revoked`, `webhook_endpoint_created`, `webhook_endpoint_enabled`/`disabled`, `webhook_endpoint_deleted`.

**Integration connections** (`integration-connection-actions.ts`): `integration_disconnected`, `integration_default_account_changed`, `integration_entities_synced`.

**Auth** (`auth-actions.ts` + new client-reported endpoint): `auth_signup`, `auth_password_reset_requested` (server-side, `AdminAuditEvent`), `auth_login_success`, `auth_login_failed`, `auth_logout`, `auth_mfa_enrolled`, `auth_mfa_unenrolled`, `auth_password_changed` (client-reported, see below).

**BigCapital / accounting push** (`lib/integration-push.ts`, `models/bigcapital.ts`, action files): `integration_push_succeeded`, `integration_push_failed` (terminal only), `integration_push_enqueued`, `integration_batch_push`, `bigcapital_provisioned`, `bigcapital_provision_failed` (terminal only), `bigcapital_provision_enqueued`.

**Misc**: `activity_exported` (the CSV export button audits itself, same pattern as the existing `file_exported`).

### New files
- `lib/auth-audit.ts` — `recordAdminAudit()`, an `AdminAuditEvent` writer that never throws and folds `sourceIp`/`userAgent` into `detail` (that table has no dedicated columns for them).
- `app/api/internal/auth/audit/route.ts` — POST endpoint the client calls after Supabase SDK auth events (login/logout/MFA/password-change happen entirely client-side; the server has no visibility otherwise). Allowlisted event types, allowlisted `detail` keys, rate-limited, session-gated for everything except `auth_login_failed`.
- `lib/auth-audit-client.ts` — `reportAuthEvent()`, fire-and-forget fetch wrapper for the above, wired into `login-form.tsx`, `account-menu.tsx`, `sign-out-button.tsx`, `sign-out-everywhere-button.tsx`, `mfa-enroll.tsx`, `password-reset-forms.tsx`.
- `app/(app)/workspaces/[workspaceId]/(chrome)/settings/activity/export/route.ts` — CSV export of the activity feed, same filters as the page, uncapped to 10,000 rows.

### UI: Activity page filtering + export
`app/(app)/workspaces/[workspaceId]/(chrome)/settings/activity/page.tsx` — was a flat 100-row list, now has:
- Event-type filter (dropdown built from `listWorkspaceAuditEventTypes` — only types that actually occurred in this workspace, not the full catalogue)
- Actor filter (`listWorkspaceAuditEventActors`)
- Date range (from/to)
- Export CSV button, same query params as the page filters
- Outcome and source-IP columns added to the table (the query already selected them nowhere near enough — `models/audit-events.ts`'s `listWorkspaceAuditEvents` select was expanded)

All filter state lives in the URL (plain GET form) so the export link can carry the exact same filters without duplicating state in a client component.

---

## Decisions taken

1. **`deleteWorkspace` writes to `AdminAuditEvent`, not `DocumentAuditEvent`.** The workspace→`DocumentAuditEvent` FK is `onDelete: Restrict` specifically so a workspace can't be deleted while carrying undestroyed evidence — the delete flow already archives those rows first (`lib/audit-archive.ts`). But the row saying "who deleted this workspace" must itself survive the deletion, so it goes in the platform-level table instead, written *before* the cascade.
2. **Background-job audit writes use `recordSystemAudit`, not `recordDocumentAudit`.** The push engine (`lib/integration-push.ts`) and BigCapital provisioning (`models/bigcapital.ts`) run in the job worker with no request context — `recordDocumentAudit` would try `next/headers()` and throw. `recordSystemAudit` always writes `actorId: null, sourceIp: null, userAgent: null`.
3. **Only terminal failures are audited for pushes/provisioning, not every retry.** `attemptIntegrationPush`/`attemptProvisionJob` retry with backoff; auditing every intermediate attempt would drown the one row that actually matters (the terminal outcome) in noise. Checked via `update.status === "failed"` / `exhausted`.
4. **Client-reported auth events are constrained to an allowlist on both axes** — event *type* (6 fixed strings) and `detail` *keys* (`email`, `method`, `reason`, string-only, 200-char cap). This endpoint is the one place a client can write directly into `AdminAuditEvent`; it must never become a way to inject arbitrary rows.
5. **P3 (admin suspend/unsuspend) was investigated and explicitly NOT built.** `next-admin-options.ts` excludes `User.role`/`suspendedAt` from the generated CRUD editor with a comment pointing at a `/admin/users` route that doesn't exist in this codebase (admin-next replaced the old `/admin` at some point and that action was never rebuilt). Building it — last-admin check, self-modification check, session sweep, audit row — is a new feature, not an audit-trail gap. Flagged to the user, not built.

---

## What's proven, not just written

Every new event type was exercised **live** in the browser against this dev environment's real database and a **real self-hosted BigCapital instance** (already running locally: mariadb/redis/garage containers + app server on :4000), not just covered by unit tests:

- Logged in as the seeded demo account → confirmed `auth_login_success` fired through the client-reported endpoint
- Enabled the Accounting module (`SECRETS_ENCRYPTION_KEY` + `BIGCAPITAL_ENABLED=true` in `.env`, gitignored, not committed) — required an `npm run db:generate` because the worktree's Prisma client predated the `BigcapitalAccount`/`IntegrationProvisionJob` models (pre-existing issue, unrelated to this branch, documented in memory as `admin-console-auth-invariants.md`)
- "Sync now" → `integration_entities_synced` confirmed in the filtered activity log
- Pushed an already-ledgered invoice → hit the ledger-duplicate check → `integration_push_failed` confirmed (terminal, correct)
- Uploaded a genuinely new invoice, reviewed it, pushed it → `integration_push_succeeded` confirmed
- Created/revoked an API key → `api_key_created`/`api_key_revoked` confirmed
- Created/disabled/deleted a webhook endpoint → all three confirmed
- Exported the activity CSV → `activity_exported` confirmed, and the export route itself returned real data

**Bonus finding, not implemented:** confirmed live that if a user logs into BigCapital's own UI directly and edits something, DocuBite's audit trail has **zero visibility into it** — `syncAccountingEntities` only pulls current state, it doesn't diff or log changes. Investigated BigCapital's server source (a local checkout at `~/Downloads/bigcapital/bigcapital-develop`) and confirmed it exposes a real `GET /audit-logs` endpoint (`packages/server/src/modules/EE/AuditLogs/`) — paginated, filterable by subject/action/userId/date, reachable with the *same* API key DocuBite already stores per workspace, no extra credential needed. Proved it by decrypting the stored key and curling the live endpoint — it returned exactly the bills/vendors this session had pushed, with `user_id`/`user_name`/`ip`/`created_at`. **Not mirrored into DocuBite's own trail yet** — that's the natural next step (a `pollBigcapitalAuditLog` job, cursor on BigCapital's `id`, tagged e.g. `bigcapital_external_change` so it's distinguishable from DocuBite-initiated events).

---

## Known follow-ups (deferred, by design)

1. **Mirror BigCapital's own audit log into DocuBite's trail** — see above. Scoped but not built.
2. **Admin suspend/unsuspend action + its audit trail** — see decision #5. Would need last-admin/self-modification guards before the audit write means anything.
3. **`admin-next`'s generated CRUD route has no audit trail at all** — mentioned as P3 lower-priority in the original plan, not investigated further this round. Sensitive fields (`role`, `suspendedAt`) are already excluded from the editable set, which limits the blast radius, but any other field edit through that route is silent.
4. **Pre-existing, unrelated:** `models/bigcapital.ts` and `admin-next/next-admin-options.ts` show `PrismaClient` type errors (`bigcapitalAccount`, `integrationProvisionJob` "does not exist") in a fresh `tsc` run until `npm run db:generate` is run in the worktree. Not caused by this branch — the worktree's committed schema already had these models; only the *generated client* was stale.

---

## How to run locally (for the next session)

- Tests: `npx vitest run` (1090 tests, ~25s)
- Types: `npx tsc --noEmit` (run `npm run db:generate` first if you see `bigcapitalAccount`/`integrationProvisionJob` errors — that regenerates the Prisma client + `next-admin`'s JSON schema, takes ~60s)
- To see the Accounting module locally: add `SECRETS_ENCRYPTION_KEY` (32 random bytes, base64) and `BIGCAPITAL_ENABLED=true` to `.env`, needs a reachable BigCapital instance at `BIGCAPITAL_API_BASE` (default `http://localhost:4000`) — a dev checkout exists at `~/Downloads/bigcapital/bigcapital-develop` with `docker-compose.yml` for the supporting services (mariadb/redis/garage/gotenberg); the app server itself is started separately (`pnpm dev` or similar in that repo)
- `next build` poisons turbopack dev — delete `.next` before `npm run dev` if routes start 404ing for no reason (hit this twice this session, both times on a fresh `.env` change requiring a server restart)
- Seeded demo login: `demo@docubite.local` / `demo-docubite-2026` (see `prisma/seed.ts`)
