# DocuBite — Deepgram ASR & AI-Suggested Fields: Handoff

_Last updated: 2026-08-20. Companion to `HANDOFF-STRUCTURED-RETRIEVAL.md` (Stage 3 built dictation on
Hugging Face Whisper), which remains accurate for everything except the ASR backend choice below._

Two pieces of work, both verified against the real dev database and a real LLM/ASR call, not just
unit tests. Both are additive: existing behaviour is unchanged unless the new config is set.

---

## 1. Deepgram ASR backend

**Why:** Whisper on HF serverless (Stage 3's default) exposes no keyword-biasing parameter, so
domain vocabulary could only be corrected after the fact, never applied at recognition time.
Deepgram's `nova-3-medical` is trained on clinical vocabulary and supports biasing natively.

**Built** — `lib/asr/deepgram.ts`, a second `AsrBackend` implementation alongside the HF one
(`lib/asr/index.ts` picks by `ASR_BACKEND`):
- Posts raw audio bytes directly (`Content-Type: <mime>`), not HF's JSON/base64 envelope.
- `supportsBiasTerms = true` — honestly, because Deepgram actually applies them, unlike HF Whisper.
- **nova-3 dropped the `keywords` query param in favour of `keyterm` prompting.** Sending `keywords`
  to a nova-3 model doesn't error — it silently stops applying the domain vocabulary. The backend
  picks the param name from the model name (`nova-3*` → `keyterm`, everything else → `keywords`)
  rather than hard-coding one; caught only by knowing Deepgram's model-generation history, not by
  anything the API would tell you.
- Utterance-level segments preferred for provenance (closer to Whisper's sentence chunks than raw
  word timestamps); falls back to word-level timestamps if the response has none.

**Verified live** against a real clinical dictation clip end-to-end via a direct backend call
(bypassing the app to isolate the ASR step): clean transcript, correct medical terms (niacin, HDL,
hypercholesterolemia, seborrheic dermatitis), 33 provenance segments.

**Config:**
```
ASR_BACKEND     = deepgram                 # was: huggingface
ASR_API_KEY     = <deepgram key>           # no fallback — huggingface's EMBEDDINGS_API_KEY fallback
                                            #   does not apply to deepgram, they're different tokens
ASR_MODEL_NAME  = nova-3-medical           # English-only; there is no multilingual medical variant
# ASR_BASE_URL is NOT needed for deepgram — its URL is fixed (https://api.deepgram.com)
```

---

## 2. AI-suggested fields for dictation, human-approved

**Problem:** extraction is deliberately "restructure, never infer" (`lib/document-transcription.ts`)
— the model sorts what was said into fields it's handed, so a value is never invented. That
guarantee is about *values*. It says nothing about content the speaker clearly stated that the
current template simply has no field for — a marker, a measurement, a fact the template's author
didn't anticipate. That content was silently lost: present in the transcript, absent from the
structured fields, the sheet, and the report.

**Built** — the other half of the restructuring prompt. Alongside the normal pass, the model may
also propose new fields for content it couldn't place, returned as `_suggested_fields` in the same
JSON-schema-constrained response (`lib/field-suggestions.ts` builds the prompt fragment and schema
fragment; `lib/document-transcription.ts` splices them into the existing call). A proposal is
**not a write** — nothing changes until a person acts on it.

- `field_suggestions` table (migration `20260819220000_add_field_suggestions`) — one pending row
  per proposed field per document, capturing `key`, `label`, `type`, `instruction`, the `value`
  and `quote` the model found *at proposal time* (re-reading the transcript later on approval risks
  a second pass disagreeing with the first about what was said), and a `confidence`.
- **Approve** (`models/field-suggestions.ts::acceptFieldSuggestion`) appends the field to the
  template as a new `DocumentTemplateVersion` — the exact mechanism a manual template edit already
  uses (`updateDocumentTemplateAction`) — and backfills the value onto *only* the document the
  proposal came from, re-pinning it to the new version. Every other document keeps its old template
  snapshot untouched, same as any other template edit. Audio provenance for the new field is
  resolved for real against the document's stored transcript segments (`resolveAudioRef`), not
  faked.
- **Dismiss** marks the row `dismissed`; nothing else changes. Suggestions are never deleted on
  dismiss — a silently vanished proposal would look identical to one nobody ever reviewed.
- UI: `components/dictation/suggested-fields.tsx`, a "Suggested fields" card above Extracted
  fields on the verify screen, Accept/Dismiss per suggestion.
- Capped at 6 suggestions per dictation (`MAX_SUGGESTIONS` in `lib/field-suggestions.ts`) — a
  transcript with a dozen genuinely novel facts is the exception, and an uncapped list turns one
  odd dictation into review-queue noise.

**Verified live** against the real dev DB with a real LLM call (not a mocked one): re-ran
structuring on a real dictation whose content was mostly outside the pathology schema. The model
correctly left every pathology field empty (no hallucination) and proposed exactly two fields —
`patient_age` ("45 year old") and `patient_gender` ("female") — each with an accurate quote.
Approving `patient_age` was then confirmed end to end: template version bumped 1→2, the source
document re-pinned to the new version and **only** that document, `reviewedData.patient_age`
backfilled, a real audio-provenance pin resolved (1.12s–4.8s, score 0.8) matching the actual quote,
and a proper row written into `document_field_values` (so the field is sheet/search-visible too).

**Tests:** 9 new unit tests for the parse/coerce/cap logic in `lib/field-suggestions.test.ts`
(malformed entries, duplicate keys, key-collision-with-existing-field, unsupported-type coercion,
the suggestion cap). Full suite: 46 files / 540 tests passing, `tsc` clean.

**Not built / deliberately scoped out:** editing a proposal's label or value before approving. The
review a proposal needs is "is this a real, distinct field" — if the label needs fixing once it's
real, that's an ordinary template edit through the existing template editor, not a new path.

---

## 3. Known gap found (not fixed): audio playback crash on non-ASCII filenames

Not introduced by anything above — found while manually testing dictation in-browser this session.

```
TypeError: Cannot convert argument to a ByteString because the character at index 35
has a value of 8212 which is greater than 255.
  at GET (app/api/documents/[documentId]/source/route.ts:20:10)
```

A document's `mimeType` (or something derived from the filename) is landing in a `Response` header
and contains a non-Latin-1 character — specifically an em dash (`—`, code point 8212) from a
filename like `Pathology report — 2026-08-19 20.04`. `Headers` values must be ByteStrings, so this
500s every time that document's audio is requested for playback. **Not fixed this session** —
flagged for whoever picks this up next.

---

## 4. Local dev environment notes from this session

- **Two dev servers running at once silently wedges the app.** Found the hard way: two `next dev`
  processes started seconds apart on this RAM-constrained box (see
  `dev-machine-is-memory-constrained` in project memory) left the server on port 3000 completely
  unresponsive with no error anywhere. Kill every stray `next`/`node` process and start exactly one.
- **The Prisma client is loaded once at process start.** Running `npm run db:generate` after a
  schema change does *not* get picked up by an already-running `next dev` or `worker:jobs` process
  — Turbopack does not treat the generated `prisma/client` output as a watched dependency. Both
  processes need a full restart after every `db:generate`, not just the one you were touching.
  (Symptom if you forget: `TypeError: Cannot read properties of undefined (reading 'findMany')` on
  whichever new model you just added.)
- **`npm run worker:jobs` is safe to run alongside `npm run dev` now.** The old guidance against
  this was for the previous PGlite dev database (one connection, full stop). The dev DB is now a
  real Docker Postgres container (`docubite-dev-pg` on `55432`), which doesn't have that
  restriction — see `local-dev-db-is-docker-pgvector` in project memory.
