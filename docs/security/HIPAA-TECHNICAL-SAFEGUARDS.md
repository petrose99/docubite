# HIPAA technical safeguards

This document tracks the §164.312 technical safeguards and their code-level implementation. It is
a companion to `README.md`'s NIST CSF 2.0 program, not a replacement for it — `README.md`'s scope
statement still applies: health/pathology use is a separate, high-risk profile that needs legal
and privacy sign-off before it goes live, independent of how complete the table below is. A
technically-sound safeguard is a precondition for that sign-off, not a substitute for it.

Source: `docubite_hipaa_code_audit.docx` (August 2026, code-level review of `master`), tracked here
as findings F1–F19. Status reflects the codebase as of the commits referenced below, not a claim
about what is deployed in any particular environment — a control implemented in code that has not
been deployed, or whose required configuration (an env var, a Terraform apply, a signed BAA) has
not been applied, is not yet a control.

## §164.312 — Technical Safeguards

| Requirement | Section | Status | Implementation |
|---|---|---|---|
| Unique User IDs | §164.312(a)(2)(i) | ✅ | UUID per `users.id`, unchanged by this work. |
| Automatic Logoff | §164.312(a)(2)(iii) | ⚠ Partial | Session idle bound cut from 180 days to 12h (`lib/auth.ts`). A true short (≤15 min) idle timeout needs the Cognito session rewrite (Phase 2) — better-auth's JWT strategy has no server-side revocation to enforce one tightly. |
| Encryption at Rest | §164.312(a)(2)(iv) | ✅ | S3 SSE-KMS with automatic key rotation (`infra/aws/terraform/main.tf`); RDS `storage_encrypted`. |
| Access Control | §164.312(a)(1) | ✅ (code-level) | F10: `DB_SCOPE_GUARD` production default moved off→warn (the audit's top finding); RLS enable/force migration and non-superuser app role added (`prisma/migrations/20260822010000_enable_row_level_security`, `scripts/create-app-role.sql`) but `DB_RLS_ENABLED=true` is gated on completing the remaining call-site sweep. F15: per-workspace `hipaaMode` closes unauthenticated link sharing entirely. |
| Audit Controls | §164.312(b) | ✅ (code-level) | F6/F7/F11: `DocumentAuditEvent` now carries `sourceIp`/`userAgent`/`outcome`/`detail`, is append-only (DB trigger), survives a workspace delete (archived via `lib/audit-archive.ts`, FK changed CASCADE→RESTRICT), and every previously-unaudited disclosure path (raw document source, public share links) now logs both success and denial. See "Audit log retention" below. |
| Integrity Controls | §164.312(c)(1) | ✅ | SHA-256 checksums on documents, unchanged by this work. |
| Person Authentication | §164.312(d) | ❌ Not yet | F1: MFA lands with the Cognito migration (Phase 2), not yet built. |
| Transmission Security | §164.312(e)(1) | ⚠ Partial | F8: security headers plus a Content-Security-Policy shipped `Report-Only` (`next.config.ts`) — logs violations without enforcing, pending a nonce-based rollout that won't risk breaking the app. TLS is Vercel's. |

## §164.308 — Administrative Safeguards (unchanged by this work, tracked for completeness)

| Requirement | Section | Status |
|---|---|---|
| BA Contracts | §164.308(b)(1) | ⚠ In progress — see `docs/security/templates/supplier-register.csv` and the `Subprocessor` model (F16), seeded with every third party that can receive document content. AWS's BAA is self-serve via Artifact; Vercel's is a self-serve Pro add-on. Neither is confirmed signed by this document. |
| Risk Analysis | §164.308(a)(1) | ❌ Not started | F19: use the Risk Assessment Template referenced in `README.md`; nothing in this repo can complete this for you. |
| Login Monitoring | §164.308(a)(5)(ii)(C) | ❌ Not yet | F5: Cognito's built-in lockout (Phase 2) is the intended control; nothing today. |
| Password Management | §164.308(a)(5)(ii)(D) | ❌ Not yet | F3: 8-char minimum unchanged; Cognito allows up to 99 (Phase 2). |

## Audit log retention (§164.316(b), 6 years)

`DocumentAuditEvent` rows are never deleted by ordinary application code — the append-only trigger
installed by `prisma/migrations/20260822000000_hipaa_audit_hardening` refuses `UPDATE`/`DELETE`
outright except through the one path that is allowed to clear rows: `lib/audit-archive.ts`,
invoked only when a workspace is deleted, which writes every row to a JSON object in cold storage
(`audit-archives/{workspaceId}/{timestamp}.json`) before clearing them. **This repo does not yet
enforce that the archive itself is retained for 6 years** — that is a bucket lifecycle policy
(S3 Glacier transition + a 6-year minimum retention rule) that belongs in Terraform, not
application code, and is not present in `infra/aws/terraform/` as of this writing.

## Breach notification (§164.404)

Not implemented here — `docs/security/templates/incident-report.md` covers incident response
generally but does not walk through the HIPAA-specific 60-day individual notification clock, the
500-record threshold for media notification, or HHS notification timing. Add this as a named
section of the incident response policy before it is needed, not during an actual incident.

## What this document does not cover

F17 (BAAs with AI providers) and the "consider a self-hosted LLM for the highest-sensitivity
deployments" suggestion are procurement/product decisions, not code changes, and are not tracked
here. F18 (KMS key rotation) was already implemented before this audit
(`infra/aws/terraform/main.tf`, `enable_key_rotation = true`) — the original audit was wrong to
flag it as missing.
