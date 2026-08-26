# Handoff — P3 quick wins: confidence flagging, audit trail UI, domain-pack picker

**Branch:** `claude/docubite-integration-roadmap-a2b591` (same branch as P1, commit `ffdde17` on top of `674ea28`)
**Date:** 2026-08-26
**Status:** Code-complete and locally green — `npx tsc --noEmit` clean, `npm test` 666 pass (60 files), `npx next build` succeeds. **Nothing deployed.** No migration involved — these features are pure application code over models that already existed.

Continuation of the integrations roadmap (see `HANDOFF-P1-INTEGRATIONS.md`). This picks off three of the "cheap wins, interleave" items from that doc's P3 list, chosen because they needed no OAuth app registration and no staging DB access to build and verify.

## What was built

1. **Confidence surfacing in the extract panel** — `Document.confidence` (`fieldConfidence`, `missingRequiredFields`) was already computed and stored, and already drove the sheet grid's amber/red cell tint, but the extract panel's file list had no visibility into it. `models/documents.ts::flaggedFieldsFromConfidence` (new, exported) unions missing-required fields with any field below `LOW_CONFIDENCE` (now exported from `lib/sheet-seed.ts`, was module-private). `getDocumentsStatus` returns it as `flaggedFields: string[]`, threaded through `getDocumentProcessingStatusAction` → `useExtractionProgress`'s `TrackedDocumentStatus` → `StagedFile` → `FileRow`, which shows a tooltip naming the flagged fields on the "Review" badge, and a standalone amber chip + count on "Done" rows that have low-confidence-but-not-required fields.

2. **Audit trail UI** — `DocumentAuditEvent` (schema.prisma:589) had 15+ write sites across the codebase but zero reads anywhere. `models/audit-events.ts` (new) adds `listWorkspaceAuditEvents` (joins actor name/email and document filename) and `auditEventLabel` (raw type string → human label, with a title-cased fallback for anything not in the map). New page `settings/activity` lists them, newest first, available to every member — unlike Integrations this isn't plan-gated, since it's pure read-only visibility that regulated buyers ask for in procurement. Added to the sidebar between Workspace and Billing.

3. **Domain-pack picker** — Pathology and logistics packs (`lib/domains/pathology.ts`, `lib/domains/logistics.ts`) were fully built and registered in `DOMAIN_ADAPTERS` since Stage 3/4 but only reachable by editing `DEFAULT_DOCUMENT_TEMPLATES` in code — no UI path existed to add them to a file. `lib/domains/index.ts::extractionDomainPacks()` / `findExtractionDomainPack()` expose them (finance excluded — it's the default seed; general excluded — it's the ephemeral dictation-only pack). `models/files.ts::addDomainPackToFile` adds whatever worksheets from a pack a file doesn't already have (idempotent per template code, same pattern as `ensureDictationFile`'s missing-worksheet loop). New `addDomainPackAction` (owner-only) and `DomainPackPicker` component wired into the existing Settings → Templates page, one picker per file, only listing packs with something left to add.

## What's NOT done here

- No live in-browser verification — same local-dev limitation as prior sessions (`prisma dev` PGlite has no pgvector, and more relevantly here, general local dev DB setup wasn't exercised this session at all; this was tsc/test/build-level verification only).
- `models/files.ts` cannot currently be unit-tested with the repo's standard `vi.mock("@/prisma/client", ...)` pattern — confirmed this is pre-existing (reproduces with an unmodified export like `cleanFilename`, not something this session's changes caused): importing `@/models/files` in vitest throws `Cannot find package '@/prisma/client'` even with the module mocked, unlike `@/models/documents` which resolves fine under the identical mock. Root cause not diagnosed (suspect the `import { cache } from "react"` in that file interacting with Vite's SSR module graph, or a resolution-order effect specific to this module, but not confirmed). `addDomainPackToFile` is therefore covered only indirectly, via `lib/domains/index.test.ts` testing the pure `extractionDomainPacks`/`findExtractionDomainPack` functions it depends on — worth a real look if `models/files.ts` needs direct test coverage later.
- Confidence chip labels are raw field keys formatted client-side (`shipping_date` → `Shipping date`), not the template's actual field labels — fetching those would need an extra join in `getDocumentsStatus` that wasn't judged worth it for a tooltip.
- Domain-pack picker adds worksheets but doesn't remove them, and doesn't surface which packs are *already fully* added (the select only lists packs with something missing) — no "already added" indicator on a pack that's partially there.

## Files changed

- `lib/sheet-seed.ts` — exported `LOW_CONFIDENCE`
- `models/documents.ts` — `flaggedFieldsFromConfidence` (new export), `getDocumentsStatus` returns `flaggedFields`
- `app/(app)/workspaces/[workspaceId]/actions.ts` — `getDocumentProcessingStatusAction` return type; new `addDomainPackAction`
- `components/extract/{use-extraction-progress.ts,types.ts,extract-panel.tsx,file-row.tsx}` — thread `flaggedFields` through to the UI, tooltip + chip
- `models/audit-events.ts` (new), `models/audit-events.test.ts` (new)
- `app/(app)/workspaces/[workspaceId]/(chrome)/settings/activity/page.tsx` (new)
- `components/shell/sidebar.tsx` — Activity nav entry
- `lib/domains/index.ts` — `extractionDomainPacks`, `findExtractionDomainPack`; `lib/domains/index.test.ts` (new)
- `models/files.ts` — `addDomainPackToFile`
- `components/workspace/domain-pack-picker.tsx` (new)
- `app/(app)/workspaces/[workspaceId]/(chrome)/settings/templates/page.tsx` — wires the picker in per file

## Next up (per the roadmap, unchanged from HANDOFF-P1-INTEGRATIONS.md)

- P1 staging checklist still outstanding: apply the webhook migration, set `SECRETS_ENCRYPTION_KEY`, verify webhook delivery end-to-end, SSRF checks, `/api/v1` smoke test, auto-disable test. Needs explicit go-ahead before touching the production DB/env.
- P2 (Xero/QuickBooks connectors) needs OAuth app registration first.
- Remaining P3 items: confidence-based review queue/sort (today it's per-row visibility only, not a "show me only the flagged ones" filter), custom self-serve template builder, NL query exposed as a search box.
