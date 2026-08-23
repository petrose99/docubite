-- F16: the Phase 2 auth migration added a new subprocessor that wasn't in the original registry
-- seed — Supabase now receives every user's email, name, and password (hashed on their side).

INSERT INTO "subprocessors" ("id", "name", "purpose", "data_received", "baa_status", "region", "notes") VALUES
  (gen_random_uuid(), 'Supabase', 'Authentication: user identity, sessions, and MFA', 'Email address, name, password (hashed by Supabase), and TOTP MFA enrollment data', 'not_applicable', NULL, 'BAA requires the Team plan + HIPAA add-on, not currently pursued (see docs/security/HIPAA-TECHNICAL-SAFEGUARDS.md) — this migration is a technical improvement, not a claim of BAA coverage. Revisit baa_status if that changes. No document content reaches Supabase; this project holds auth data only.')
ON CONFLICT ("name") DO NOTHING;
