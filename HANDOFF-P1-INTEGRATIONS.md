# Handoff — P1: Webhooks + API keys + `/api/v1`

**Branch:** `claude/docubite-integration-roadmap-a2b591` (worktree `pdf-data-extraction-db-752034`)
**Date:** 2026-08-26
**Status:** P1 **code-complete and locally green** — `npx tsc --noEmit` clean, `npm test` 660 pass (57 files), `npx next build` succeeds, eslint clean on all changed files. **Nothing committed yet.** Anything needing real egress / OAuth / cron / a migrated DB is **staging-only** and untested (see the staging checklist).

This is P1 of the DocuBite integrations roadmap (the full plan is in the conversation that produced this branch; P2–P7 are summarised at the bottom).

---

## What P1 delivers

Any workspace on a paid plan can mint API keys, register HMAC-signed webhook endpoints, and receive document-lifecycle events reliably; a minimal REST surface (`/api/v1`) supports Zapier polling + REST hooks. The whole surface is dark unless `SECRETS_ENCRYPTION_KEY` is set.

### Files (all new unless marked ✎ modified)

**Pure, fully unit-tested lib modules** (each has a co-located `.test.ts`):
- `lib/secret-crypto.ts` — AES-256-GCM, envelope `v1.<iv>.<tag>.<ct>` (base64url), key rotation via `SECRETS_ENCRYPTION_KEY_PREVIOUS` (decrypt-only). Used for webhook signing secrets (P2: OAuth tokens).
- `lib/webhook-signature.ts` — HMAC-SHA256 over `${t}.${body}`; header `X-DocuBite-Signature: t=..,v1=..`. Exports `verifySignature` (reference verifier for receivers).
- `lib/url-safety.ts` — SSRF guard. Pure `isBlockedIp` (v4/v6/mapped/NAT64 range table) + async `assertUrlSafe` (https-only, DNS-resolve-and-reject-private, injectable resolver).
- `lib/api-key.ts` — `dbk_live_<40>` keys, sha256 hash-only storage, `keyPrefix` display label, bearer parsing.
- `lib/webhook-delivery-policy.ts` — pure retry/disable decisions: `backoffMinutes` (2,4,8,16,32,cap 60), `MAX_DELIVERY_ATTEMPTS=8`, `ENDPOINT_DISABLE_THRESHOLD=20`, `computeDeliveryUpdate`.
- `lib/webhooks.ts` — event catalog (6 `document.*` types), pure `buildDocumentEventPayload`, `emitWorkspaceEvent(tx,…)` fan-out, `buildApiDocumentResponse`/`buildApiDocumentListItem` (API shaping).

**DB / IO modules** (tested with mocked prisma where it earns it):
- `lib/api-auth.ts` — bearer → sha256 → unscoped `findUnique({keyHash})`, revoked/stale-`lastUsedAt` handling. Core takes an injectable store (fully tested).
- `lib/webhook-delivery.ts` — `claimNextWebhookDelivery` (atomic lease claim), `deliverWebhook` (SSRF re-check + decrypt + sign + POST `redirect:"manual"`, 10s timeout), `processNextWebhookDelivery`, `drainWebhookDeliveries`, `kickWebhookDrain`.
- `lib/api-v1.ts` — shared `requireApiAuth` + JSON error envelope for the routes.
- `models/integrations.ts` — workspace-scoped CRUD for keys/endpoints/deliveries + `listDocumentsForApi` (cursor pagination) + `getDocumentForApi` + `workspaceIntegrationsPlanEnabled`.

**Routes:**
- `app/api/v1/documents/route.ts` (GET list — Zapier polling trigger, cursor pagination)
- `app/api/v1/documents/[documentId]/route.ts` (GET one + field_values)
- `app/api/v1/webhook-endpoints/route.ts` (GET, POST — subscribe, secret returned once)
- `app/api/v1/webhook-endpoints/[endpointId]/route.ts` (GET, DELETE — unsubscribe)
- `app/api/v1/deliveries/[deliveryId]/redeliver/route.ts` (POST)
- ✎ `app/api/internal/jobs/process/route.ts` — now also drains webhook deliveries (existing cron covers both queues; `{drainWebhooks:true}` skips the job drain).

**UI:**
- `app/(app)/workspaces/[workspaceId]/(chrome)/settings/integrations/page.tsx` — server page, deployment-gated (`notFound()`), plan-gated (upgrade note).
- `components/integrations/integrations-manager.tsx` — client: API-keys card, endpoints card, deliveries table, secret-shown-once reveal.
- `app/(app)/workspaces/[workspaceId]/integrations-actions.ts` — owner-gated server actions.
- ✎ `components/shell/sidebar.tsx` + ✎ `layout.tsx` — Integrations nav entry, omitted when `config.integrations.enabled` is false.
- ✎ `action-helpers.ts` — `integrations` path + error-code vocabulary.

**Schema / config / wiring:**
- ✎ `prisma/schema.prisma` — `WorkspaceApiKey`, `WebhookEndpoint`, `WebhookDelivery` (+ Workspace/User/Document inverse relations).
- `prisma/migrations/20260826000000_add_integration_webhooks/` — DDL + **inert** RLS policies (enable step deliberately left commented, matching `20260819190000`).
- ✎ `lib/workspace-scope.ts` — the three models added to `WORKSPACE_SCOPED_MODELS`.
- ✎ `lib/config.ts` — `config.integrations` gate; ✎ `.env.example` documents `SECRETS_ENCRYPTION_KEY(_PREVIOUS)`.
- ✎ `lib/plans.ts` — `WorkspacePlan.integrations` (true on all paid plans).
- ✎ `lib/document-processing.ts` + ✎ `models/documents.ts` + ✎ `worker/job-worker.ts` — emit hook points + drain in worker loop.

### Emit hook points (all fan out in-tx, kick drain post-commit)
- `processDocumentJob` tail → `document.ready_for_review` / `document.needs_review`
- `failDocumentJob` permanent branch → `document.failed`
- `createDocumentFromBuffer` → `document.received`
- `updateDocumentReview` → `document.reviewed` / `document.needs_review` (the key connector trigger)
- `deleteWorkspaceDocuments` → `document.deleted` (id + filename only; delivery `documentId` null)

---

## Two decisions taken vs. the written plan
1. **`WebhookDelivery` carries `workspaceId` directly** (plan listed only `endpointId`). Needed for the RLS policy and to scope the settings list without a join. Consistent with every other tenant table.
2. **`buildDocumentEventPayload` inlines `documentDataForExport`'s 2-line projection** instead of importing it from `models/`. A runtime import from `models/` pulls the Prisma-client chain that vitest's resolver can't follow (`@/prisma/client` is a tsconfig-only path alias). Keeping `lib/webhooks.ts` a leaf is what makes it testable. Comment in the file flags the duplication.

---

## Staging checklist (NOT verifiable locally — do these next)
Local limits: no local embeddings, PGlite shadow can't run `migrate dev`, no cron/egress. So:

1. **Apply the migration.** `prisma migrate deploy` on staging (docubite.vercel.app DB). Verify all tables + indexes exist. The migration was hand-written to Prisma's DDL conventions and `prisma validate` passes, but it was never applied to a real DB here (`migrate diff` needs a shadow DB). **Review the SQL before deploying.**
2. **Set `SECRETS_ENCRYPTION_KEY`** in staging env: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Without it the whole surface stays 404/omitted (by design).
3. **Webhook delivery end-to-end**: register an endpoint pointing at https://webhook.site, review a document, confirm a signed POST arrives, signature verifies, and a redelivery works. Confirm the cron (cron-job.org → `/api/internal/jobs/process`) drains deliveries.
4. **SSRF**: confirm registering `http://169.254.169.254/…` and a hostname resolving to a private IP are both rejected.
5. **`/api/v1`**: mint a key, hit `GET /api/v1/documents` (pagination + `updated_since`), `GET /api/v1/documents/:id`, endpoint subscribe/unsubscribe.
6. **Auto-disable**: point an endpoint at a always-500 URL, confirm it disables after 20 consecutive failures and writes a `webhook_endpoint_disabled` audit event.
7. **Zapier**: the Zapier CLI app is a separate repo — budget its review (2–6 weeks). Start the app registration now.

### Known follow-ups (deferred in P1, by design)
- **v1.1**: `POST /api/v1/documents` (multipart upload through `createDocument` + `consumeWorkspaceQuota`) — makes Zapier two-way. Not built yet.
- **Rate limiting**: none in v1 (nothing in-process works on Vercel). Follow-up: per-key Postgres fixed-window counter.
- **DNS-rebinding residual**: `assertUrlSafe` re-resolves at delivery with no redirects, but doesn't pin the resolved IP into the fetch. Acceptable v1; harden later.
- **RLS-under-FORCE**: the unscoped `findUnique` by keyHash (api-auth) and the global delivery drain have the same latent tension every existing system path has (Stripe handler, job worker) — fine today (RLS not FORCEd in prod), to be solved with a bypass role at the RLS rollout.

---

## P2–P7 (next phases, per the roadmap)
- **P2 — QuickBooks + Xero connectors.** Reuse `lib/secret-crypto.ts` for OAuth tokens; new `IntegrationConnection`/`IntegrationPush` models; push a reviewed finance doc as a Bill; **row-lock token-refresh serialization is mandatory** (Xero single-use refresh tokens). Start Intuit + Xero app registration day 1. The webhook drain generalises to also drain `IntegrationPush`.
- **P3 (cheap wins, interleave):** domain-pack picker (packs already built in `lib/domains/`), audit-timeline UI (`DocumentAuditEvent` already written, zero UI reads it), confidence surfacing + review queue, expose NL query (ops: provision embeddings + backfill).
- **P4:** approval workflows (resurrect dead `markDocumentsReviewedAction`; the `document.reviewed` webhook from P1 makes approval the integration trigger).
- **P5:** email-to-inbox capture (greenfield rebuild; keep the deleted predecessor's sender-hash privacy posture).
- **P6:** mobile capture (fix `viewport.userScalable`, camera capture, responsive pass).
- **P7:** pricing — free tier + annual (`lib/plans.ts`; a free plan would set `integrations:false`, which the P1 plan-gate already honours).

---

## How to run locally (for the next session)
- Tests: `npm test` (or `npx vitest run lib/webhook*.test.ts` etc.). All new logic lives under `lib/**`/`models/**` per the vitest globs.
- Types: `npx tsc --noEmit`. Build: `npx next build`.
- **Lint changed files explicitly** — repo-wide `npm run lint` OOMs on worktree `.next` dirs.
- `next build` poisons turbopack dev — delete `.next` before `npm run dev`.
- Memory note `p1-integrations-foundation-progress.md` tracks this work; update it as P1 lands on staging.
