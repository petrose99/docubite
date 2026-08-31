import { z } from "zod"
import packageJson from "../package.json"

const PLACEHOLDER_WORKER_SECRET = "replace-this-with-a-long-worker-secret"

const envSchema = z.object({
  BASE_URL: z.string().url().default("http://localhost:7331"),
  PORT: z.string().default("7331"),
  // Read directly off process.env by lib/db.ts (the Prisma adapter) and prisma.config.ts, both of
  // which need it before this module can plausibly have run. Declared here anyway so it is
  // validated and covered by the production placeholder/unset guard below — previously it bypassed
  // both, so a production deploy with no DATABASE_URL at all would fail at first query with an
  // adapter-level connection error rather than at boot with a clear message.
  DATABASE_URL: z.string().optional(),
  // Same story as DATABASE_URL: read directly off process.env by lib/malware-scan.ts. Declared
  // here purely so an accidentally-empty value is validated rather than silently sending an
  // unauthenticated scan request.
  MALWARE_SCAN_TOKEN: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL_NAME: z.string().default("gpt-4o-mini"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL_NAME: z.string().default("gemini-2.5-flash"),
  AI_PROVIDER: z.enum(["openai", "gemini"]).default("openai"),
  // NEXT_PUBLIC_-prefixed because lib/supabase/client.ts (a "use client" module) reads these two
  // directly off process.env — Next.js only inlines that prefix into the browser bundle at build
  // time, and only for a literal `process.env.NEXT_PUBLIC_X` reference, so client.ts cannot get
  // them by importing this file's `config` object instead. Declared here too so both are validated
  // and so server code (getAdminClient, etc.) can read them through `config` like everything else.
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  // Server-only, admin-privileged — must never carry the NEXT_PUBLIC_ prefix or it would ship to
  // the browser. Covered by the production unset guard below, the same way BETTER_AUTH_SECRET
  // (removed along with better-auth) used to be.
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // The "v1,whsec_..." secret from the Supabase dashboard's Before User Created Auth Hook config
  // (Authentication → Hooks). Verifies the Standard Webhooks HMAC signature on incoming hook
  // requests — see app/api/internal/auth/signup-allowed/route.ts.
  SUPABASE_AUTH_HOOK_SECRET: z.string().optional(),
  // §164.312(a)(2)(iii) automatic logoff. Supabase Auth has a native Inactivity Timeout setting
  // (Authentication → Sessions), but it's gated to the Pro plan and above — a Free-plan project
  // (like this one, as of the HIPAA migration) has no dashboard control for it at all. This is the
  // app-level fallback enforced in lib/supabase/middleware.ts regardless of plan tier.
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(15),
  DISABLE_SIGNUP: z.enum(["true", "false"]).default("false"),
  RESEND_API_KEY: z.string().default("please-set-your-resend-api-key-here"),
  RESEND_FROM_EMAIL: z.string().default("DocuBite <user@localhost>"),
  // Both halves or nothing — a UI-only flag now (see isGoogleAuthEnabled); a half-set pair would
  // advertise a Google button whose provider isn't actually registered on the Supabase side.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  AWS_REGION: z.string().default("eu-west-1"),
  AWS_S3_DOCUMENTS_BUCKET: z.string().default(""),
  AWS_S3_KMS_KEY_ID: z.string().default(""),
  INTERNAL_WORKER_SECRET: z.string().min(24).default(PLACEHOLDER_WORKER_SECRET),
  MALWARE_SCAN_URL: z.string().url().optional(),
  DOCUMENT_MAX_PAGES: z.coerce.number().int().default(-1),
  DOCUMENT_PAGES_PER_BATCH: z.coerce.number().int().positive().default(8),
  // Optional so the app boots without it; document jobs then fail permanently with
  // mineru_not_configured rather than the whole process refusing to start.
  MINERU_API_TOKEN: z.string().optional(),
  MINERU_API_BASE: z.string().url().default("https://mineru.net"),
  MINERU_MODEL_VERSION: z.string().default("vlm"),
  MINERU_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  MINERU_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  // Semantic document search (RAG). Optional so the app boots without it: with no base URL the
  // feature is dark everywhere — nothing is enqueued, the embed job handler no-ops, and the
  // assistant is never given the search tool. Points at any OpenAI-compatible /embeddings endpoint
  // (Ollama locally, a hosted provider in prod).
  EMBEDDINGS_BASE_URL: z.string().url().optional(),
  EMBEDDINGS_API_KEY: z.string().optional(),
  // "openai" — an OpenAI-compatible /embeddings endpoint (Ollama, a Hugging Face TEI Inference
  // Endpoint, most hosted providers). "huggingface" — HF's serverless Inference API, whose
  // feature-extraction task has its own request/response shape (see lib/embeddings.ts).
  EMBEDDINGS_FORMAT: z.enum(["openai", "huggingface"]).default("openai"),
  EMBEDDINGS_MODEL_NAME: z.string().default("nomic-embed-text-v1"),
  EMBEDDINGS_DIMENSIONS: z.coerce.number().int().positive().default(768),
  EMBEDDINGS_BATCH_SIZE: z.coerce.number().int().positive().default(32),
  EMBEDDINGS_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  // Query routing: parse a natural-language query into structured pre-filters plus a semantic
  // remainder before searching. Off by default and fail-safe by design — with it off, or on any
  // parse failure, retrieval behaves exactly as it did before the router existed.
  RETRIEVAL_ROUTER_ENABLED: z.string().optional(),
  // Cross-encoder reranking of fused hits. With no base URL the reranker is the identity function,
  // which is the shipped default: ordering is not reranked until it has been measured as bad.
  RERANK_BASE_URL: z.string().url().optional(),
  RERANK_API_KEY: z.string().optional(),
  RERANK_MODEL_NAME: z.string().default("BAAI/bge-reranker-base"),
  RERANK_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  // Speech-to-text ingestion (dictation). Optional so the app boots without it: with no base URL
  // audio uploads are refused as an unsupported type and the dictation UI stays hidden.
  //
  // The model default is Whisper, NOT Qwen3-ASR. Qwen/Qwen3-ASR-1.7B-hf was probed against HF
  // serverless on 2026-08-19 and returns 400 "Model not supported by provider hf-inference" — it
  // has no provider mapping at all, the same failure that ruled out nomic-embed for embeddings.
  // whisper-large-v3-turbo is live there and returns segment timestamps, which audio provenance
  // needs. Swapping backends is a config change; see lib/asr/index.ts.
  //
  // "deepgram" talks to Deepgram's prerecorded /v1/listen endpoint directly (lib/asr/deepgram.ts)
  // — no ASR_BASE_URL needed, since Deepgram's URL is fixed; only ASR_API_KEY. It supports native
  // keyword biasing, which HF serverless Whisper does not.
  ASR_BACKEND: z.enum(["huggingface", "deepgram"]).default("huggingface"),
  ASR_BASE_URL: z.string().url().optional(),
  ASR_API_KEY: z.string().optional(),
  // No blanket default: Whisper and Deepgram model names look nothing alike ("openai/whisper-
  // large-v3-turbo" vs "nova-2"), so the right default is picked per-backend below.
  ASR_MODEL_NAME: z.string().optional(),
  ASR_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  ASR_MAX_AUDIO_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),
  // Spoken language hint, as an ISO-639-1 code. Defaults to English; set it empty to let the model
  // auto-detect. Auto-detection is NOT a safe default: on a short or quiet recording Whisper will
  // confidently pick the wrong language and return fluent nonsense in it (observed: a 4-second
  // English clip transcribed as Icelandic). A wrong hint degrades accuracy; no hint can destroy it.
  ASR_LANGUAGE: z.string().default("en"),
  // Off by default: the embed job runs inline, awaited at the tail of whichever job produced the
  // text (extract or transcribe), exactly as it always has. On, that await is replaced by a
  // fire-and-forget kick to /api/internal/jobs/process — a SEPARATE invocation embeds the document,
  // so the producing request returns as soon as its own work (OCR/ASR + LLM) is done. This requires
  // a drain driver hitting that same route on an interval as the safety net for a dropped kick — an
  // external cron (e.g. cron-job.org) calling it every minute or so is enough; there is nothing
  // Vercel-specific about the endpoint. See EMBED_DETACHED in config.embeddings below for the full
  // gate (also requires INTERNAL_WORKER_SECRET to be set for real).
  EMBED_DETACHED: z.enum(["true", "false"]).default("false"),
  // Workspace-scope guard (lib/workspace-scope.ts).
  //   off   — no checking. Opt-in only, via an explicit env var — see below.
  //   warn  — logs every unscoped query without changing behaviour. Dev's default.
  //   throw — refuses them. Production's default now that the `warn`-caught unscoped queries
  //           (models/files.ts, models/spreadsheets.ts) are fixed.
  // `off` and unconditional `warn` used to be the defaults — a cross-tenant leak from a missing
  // workspaceId filter is exactly the failure this guard exists to catch, and shipping with it
  // non-fatal by default left every query author's memory as the only safeguard. The env var still
  // overrides in either direction for a fast rollback.
  DB_SCOPE_GUARD: z.enum(["off", "warn", "throw"]).optional(),
  // Postgres row-level security (lib/db-rls.ts). The deeper guarantee, and the riskier change;
  // gated so it can be rolled back without a redeploy, and only after DB_SCOPE_GUARD=throw holds.
  DB_RLS_ENABLED: z.string().optional(),
  // Agnostic dictation: routes a free-form dictation to a task type and output format instead of
  // requiring a pre-selected template. Off by default — see lib/dictation/router.ts.
  DICTATION_ROUTER_ENABLED: z.enum(["true", "false"]).default("false"),
  // Cosine-similarity floor a route must clear to be used. Below it (or on any router failure) the
  // dictation falls through to the general handler rather than forcing a wrong route.
  //
  // 0.65, not a rounder number: calibrated live against the real embedding model (BAAI/bge-base-
  // en-v1.5) and this file's seed examples, not guessed. Six real dictated-style sentences, one per
  // route plus one deliberately off-topic ramble, scored 0.675-0.785 for the six on-topic ones and
  // 0.441 for the ramble — a wide, clean gap. The initial guess of 0.72 sat inside that on-topic
  // cluster and rejected a genuine logistics dictation (0.675); 0.65 keeps a safety margin above the
  // ramble while accepting the full on-topic range observed.
  DICTATION_ROUTE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.65),
  // Small/fast model for the command/content-separation call (Stage B). Falls back to the main
  // structuring model when unset — see lib/dictation/extraction.ts.
  DICTATION_FAST_MODEL_NAME: z.string().optional(),
  // Adaptive extraction (lib/adaptive-extraction.ts): before the extraction prompt is built, discover
  // the document's actual line-item columns and merge them into the template's array field, so a
  // document with columns the template never anticipated (e.g. "Product Code", "Country of Origin")
  // gets them as real columns instead of crammed into the one open text field. Off by default and
  // fail-safe by design: any discovery/merge failure falls back to the template's fields unchanged.
  ADAPTIVE_EXTRACTION: z.enum(["true", "false"]).default("false"),
  // Outbound integrations (webhooks, API keys, accounting connectors). The single master gate:
  // with no encryption key set the whole surface is dark — the sidebar entry is omitted, webhook
  // secrets and connector OAuth tokens have nowhere safe to live, so none of it is offered. The
  // key is 32 random bytes, base64-encoded (AES-256-GCM); see lib/secret-crypto.ts. The optional
  // _PREVIOUS key is accepted for DECRYPT ONLY during a rotation — new writes always use the
  // current key, and a value sealed under the old key is re-encrypted lazily on its next write.
  SECRETS_ENCRYPTION_KEY: z.string().optional(),
  SECRETS_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  // Accounting connectors (P2): push a reviewed invoice/receipt to QuickBooks or Xero as a bill.
  // Each provider is its own gate (client id + secret + the master SECRETS_ENCRYPTION_KEY), so a
  // deployment can configure one, both, or neither without touching the other's card in the UI.
  QUICKBOOKS_CLIENT_ID: z.string().optional(),
  QUICKBOOKS_CLIENT_SECRET: z.string().optional(),
  // "sandbox" talks to Intuit's sandbox company; "production" to a real one. Sandbox by default so
  // an unconfigured deployment can never accidentally write a real bill.
  QUICKBOOKS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  XERO_CLIENT_ID: z.string().optional(),
  XERO_CLIENT_SECRET: z.string().optional(),
  // Bigcapital: no OAuth client — every workspace gets an auto-provisioned, isolated organization on
  // a self-hosted (or hosted) Bigcapital instance, authenticated with a per-org API key instead of a
  // redirect flow. Defaults to a local self-hosted instance so dev/staging work with zero setup;
  // production points this at the real deployment.
  BIGCAPITAL_API_BASE: z.string().url().default("http://localhost:4000"),
  // A deliberate second gate ON TOP OF the master encryption key. Unlike QuickBooks/Xero (each
  // needing its own client id/secret before it turns on), a bare SECRETS_ENCRYPTION_KEY says
  // nothing about wanting Bigcapital specifically — plenty of deployments will set it only for
  // webhooks/API keys. Without this flag, every one of those would silently start signing up real
  // Bigcapital accounts and provisioning organizations for every new workspace, with no way to opt
  // out short of disabling the whole integrations surface. Off by default.
  BIGCAPITAL_ENABLED: z.enum(["true", "false"]).default("false"),
  // Inbound email intake (WP13). Shipped dark on purpose: built and tested against recorded
  // provider fixtures, but with no inbound DNS/provider (Postmark inbound, SES) provisioned yet.
  // The route refuses everything with no secret configured — the same fail-closed shape as
  // MALWARE_SCAN_URL unset in production, not a feature flag that quietly no-ops.
  EMAIL_INBOUND_SECRET: z.string().optional(),
  // The domain inbound addresses are issued under — "<token>@" + this. Informational (shown
  // nowhere yet, since the feature is dark), read once a workspace's address needs displaying.
  EMAIL_INBOUND_DOMAIN: z.string().default("inbound.docubite.com"),
  // Nonce-based script-src (lib/csp.ts, proxy.ts). Off by default: the policy ships Report-Only
  // first so real traffic can surface anything the allowlist missed before it can block a script.
  // Flipping this is a config change, not a deploy — the whole point of staging it behind an env
  // var instead of shipping straight to enforced.
  CSP_ENFORCE: z.enum(["true", "false"]).default("false"),
})

const env = envSchema.parse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== "")))

// The placeholders are long enough to satisfy the schema, so without this a production deploy
// missing these variables would boot happily with a publicly known session signing key and a
// known bearer token for the internal job endpoint.
if (process.env.NODE_ENV === "production") {
  const unset = [
    env.INTERNAL_WORKER_SECRET === PLACEHOLDER_WORKER_SECRET && "INTERNAL_WORKER_SECRET",
    !env.DATABASE_URL && "DATABASE_URL",
    !env.NEXT_PUBLIC_SUPABASE_URL && "NEXT_PUBLIC_SUPABASE_URL",
    !env.NEXT_PUBLIC_SUPABASE_ANON_KEY && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    !env.SUPABASE_SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY",
  ].filter((name): name is string => Boolean(name))
  if (unset.length) throw new Error(`Refusing to start in production with default or missing secrets — set ${unset.join(", ")}.`)
}

/** The Google sign-in button is rendered from this env-var pair, not from whether Google is
 * actually configured as a provider on the Supabase project — that's set separately in the
 * Supabase dashboard, and this app has no way to read it back. An install without these two set
 * still boots and simply omits the button; one with them set but Google not configured on the
 * Supabase side will show the button and fail at the OAuth redirect, so keep the two in lockstep
 * by hand. */
export const isGoogleAuthEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)

const config = {
  app: { title: "DocuBite", description: "Take a bite out of document busywork. DocuBite reads invoices, receipts and bank statements — even handwritten and scanned ones — into a live sheet where every value traces to its source, and reports on whole folders: what's missing, what's duplicated, what needs a look.", version: packageJson.version || "0.0.1", baseURL: env.BASE_URL, supportEmail: "support@docubite.com" },
  ai: { openaiApiKey: env.OPENAI_API_KEY, openaiModelName: env.OPENAI_MODEL_NAME, geminiApiKey: env.GEMINI_API_KEY, geminiModelName: env.GEMINI_MODEL_NAME, provider: env.AI_PROVIDER },
  documents: { maxFileSizeBytes: 50 * 1024 * 1024, maxPages: env.DOCUMENT_MAX_PAGES, pagesPerBatch: env.DOCUMENT_PAGES_PER_BATCH, adaptiveExtraction: env.ADAPTIVE_EXTRACTION === "true" },
  mineru: { apiToken: env.MINERU_API_TOKEN || "", apiBase: env.MINERU_API_BASE.replace(/\/+$/, ""), modelVersion: env.MINERU_MODEL_VERSION, pollIntervalMs: env.MINERU_POLL_INTERVAL_MS, timeoutMs: env.MINERU_TIMEOUT_MS },
  // `enabled` is the single feature gate read by the enqueue point, the embed job handler and the
  // assistant tool registration. baseUrl has its trailing slash stripped the way mineru.apiBase does.
  embeddings: {
    enabled: Boolean(env.EMBEDDINGS_BASE_URL),
    baseUrl: (env.EMBEDDINGS_BASE_URL || "").replace(/\/+$/, ""),
    apiKey: env.EMBEDDINGS_API_KEY || "",
    format: env.EMBEDDINGS_FORMAT,
    modelName: env.EMBEDDINGS_MODEL_NAME,
    dimensions: env.EMBEDDINGS_DIMENSIONS,
    batchSize: env.EMBEDDINGS_BATCH_SIZE,
    timeoutMs: env.EMBEDDINGS_TIMEOUT_MS,
    // Gated on the worker secret being a REAL secret, not just EMBED_DETACHED=true — detaching
    // with no working bearer auth means the fire-and-forget kick 401s every time and every embed
    // silently falls back to whatever drains the queue (nothing, on an unconfigured deployment).
    detached: env.EMBED_DETACHED === "true" && env.INTERNAL_WORKER_SECRET !== PLACEHOLDER_WORKER_SECRET,
  },
  // Retrieval behaviour on top of the hybrid search. Both are additive and both default to off,
  // so an unconfigured deployment retrieves exactly as it did before Stage 2.
  retrieval: {
    routerEnabled: env.RETRIEVAL_ROUTER_ENABLED === "true",
    rerankEnabled: Boolean(env.RERANK_BASE_URL),
    rerankBaseUrl: (env.RERANK_BASE_URL || "").replace(/\/+$/, ""),
    rerankApiKey: env.RERANK_API_KEY || "",
    rerankModelName: env.RERANK_MODEL_NAME,
    rerankTimeoutMs: env.RERANK_TIMEOUT_MS,
  },
  // `enabled` is the single feature gate for the whole dictation path: the accepted MIME lists,
  // the transcribe job, and the dictation UI all read it. The API key falls back to the embeddings
  // key because both are Hugging Face tokens in the default deployment — that fallback only makes
  // sense for the huggingface backend, so deepgram requires its own ASR_API_KEY.
  //
  // Deepgram's URL is fixed (lib/asr/deepgram.ts), so `enabled` for it depends on the API key
  // being set rather than on ASR_BASE_URL, which huggingface needs but deepgram does not.
  asr: {
    enabled: env.ASR_BACKEND === "deepgram" ? Boolean(env.ASR_API_KEY) : Boolean(env.ASR_BASE_URL),
    backend: env.ASR_BACKEND,
    baseUrl: (env.ASR_BASE_URL || "").replace(/\/+$/, ""),
    apiKey: env.ASR_API_KEY || (env.ASR_BACKEND === "huggingface" ? env.EMBEDDINGS_API_KEY : undefined) || "",
    modelName: env.ASR_MODEL_NAME || (env.ASR_BACKEND === "deepgram" ? "nova-2" : "openai/whisper-large-v3-turbo"),
    timeoutMs: env.ASR_TIMEOUT_MS,
    maxAudioBytes: env.ASR_MAX_AUDIO_BYTES,
    language: env.ASR_LANGUAGE.trim() || null,
  },
  aws: { region: env.AWS_REGION, documentsBucket: env.AWS_S3_DOCUMENTS_BUCKET, kmsKeyId: env.AWS_S3_KMS_KEY_ID, internalWorkerSecret: env.INTERNAL_WORKER_SECRET, malwareScanUrl: env.MALWARE_SCAN_URL },
  auth: { loginUrl: "/login", disableSignup: env.DISABLE_SIGNUP === "true", idleTimeoutMinutes: env.SESSION_IDLE_TIMEOUT_MINUTES, google: { clientId: env.GOOGLE_CLIENT_ID || "", clientSecret: env.GOOGLE_CLIENT_SECRET || "" } },
  // The project itself, plus the two keys: anonKey is safe in the browser (Postgres RLS is what
  // actually protects data reached through it — irrelevant here since this project is Auth-only
  // and holds no application tables), serviceRoleKey bypasses RLS entirely and is used only from
  // the two server-only paths that need admin privileges: the bulk user-migration script and
  // prisma/seed.ts. Never construct a client with serviceRoleKey outside those.
  supabase: { url: env.NEXT_PUBLIC_SUPABASE_URL || "", anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "", serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || "", authHookSecret: env.SUPABASE_AUTH_HOOK_SECRET || "" },
  email: { apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL },
  // Tenant isolation. Both default to their safe-for-a-live-app setting; see the env comments for
  // the staged adoption path from `warn` to `throw` to RLS.
  isolation: {
    // `warn` in dev keeps local iteration unblocked; production defaults to `throw` now that the
    // five unscoped queries it caught (models/files.ts, models/spreadsheets.ts) are fixed. The env
    // var still overrides either way for a fast rollback.
    scopeGuard: env.DB_SCOPE_GUARD ?? (process.env.NODE_ENV === "production" ? "throw" : "warn"),
    rlsEnabled: env.DB_RLS_ENABLED === "true",
  },
  security: { cspEnforce: env.CSP_ENFORCE === "true" },
  // `enabled` gates the whole inbound-email surface, the same "off unless a real secret is set"
  // shape as embeddings/integrations elsewhere in this file. Off by default in every environment,
  // including production, until DNS/a provider is actually provisioned for it.
  inboundEmail: { enabled: Boolean(env.EMAIL_INBOUND_SECRET), secret: env.EMAIL_INBOUND_SECRET || "", domain: env.EMAIL_INBOUND_DOMAIN },
  // Agnostic dictation (lib/dictation). Off by default and fail-safe by design: with it off, or on
  // any router/extraction failure, a dictation with no pre-selected template still gets the general
  // handler's default format — never a forced route, never a blocked recording.
  dictation: {
    routerEnabled: env.DICTATION_ROUTER_ENABLED === "true",
    routeThreshold: env.DICTATION_ROUTE_THRESHOLD,
    fastModelName: env.DICTATION_FAST_MODEL_NAME || "",
  },
  // Outbound integrations. `enabled` is the one gate the sidebar, settings page and every emitter
  // read — off when no encryption key is configured, exactly as `embeddings.enabled` gates RAG.
  // The two keys are handed to lib/secret-crypto.ts; `encryptionKeyPrevious` is decrypt-only.
  integrations: {
    enabled: Boolean(env.SECRETS_ENCRYPTION_KEY),
    encryptionKey: env.SECRETS_ENCRYPTION_KEY || "",
    encryptionKeyPrevious: env.SECRETS_ENCRYPTION_KEY_PREVIOUS || "",
    // Accounting connectors. Each `enabled` also requires the master encryption key — without it
    // there is nowhere safe to store the OAuth tokens, so the card stays hidden even if a client
    // id/secret pair is set.
    quickbooks: {
      enabled: Boolean(env.SECRETS_ENCRYPTION_KEY && env.QUICKBOOKS_CLIENT_ID && env.QUICKBOOKS_CLIENT_SECRET),
      clientId: env.QUICKBOOKS_CLIENT_ID || "",
      clientSecret: env.QUICKBOOKS_CLIENT_SECRET || "",
      environment: env.QUICKBOOKS_ENVIRONMENT,
    },
    xero: {
      enabled: Boolean(env.SECRETS_ENCRYPTION_KEY && env.XERO_CLIENT_ID && env.XERO_CLIENT_SECRET),
      clientId: env.XERO_CLIENT_ID || "",
      clientSecret: env.XERO_CLIENT_SECRET || "",
    },
    // Bigcapital: no OAuth client id/secret — every workspace gets an auto-provisioned, isolated
    // organization instead, authenticated with a per-org API key. `enabled` requires BOTH the
    // master encryption key AND an explicit BIGCAPITAL_ENABLED=true — see that var's comment above
    // for why the encryption key alone isn't a safe enough signal for this one.
    bigcapital: {
      enabled: Boolean(env.SECRETS_ENCRYPTION_KEY) && env.BIGCAPITAL_ENABLED === "true",
      apiBase: env.BIGCAPITAL_API_BASE.replace(/\/+$/, ""),
    },
  },
} as const

export default config
