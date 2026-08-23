import { z } from "zod"
import packageJson from "../package.json"

const PLACEHOLDER_AUTH_SECRET = "please-set-a-production-auth-secret"
const PLACEHOLDER_WORKER_SECRET = "replace-this-with-a-long-worker-secret"

const envSchema = z.object({
  BASE_URL: z.string().url().default("http://localhost:7331"),
  PORT: z.string().default("7331"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL_NAME: z.string().default("gpt-4o-mini"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL_NAME: z.string().default("gemini-2.5-flash"),
  AI_PROVIDER: z.enum(["openai", "gemini"]).default("openai"),
  BETTER_AUTH_SECRET: z.string().min(16).default(PLACEHOLDER_AUTH_SECRET),
  DISABLE_SIGNUP: z.enum(["true", "false"]).default("false"),
  ENFORCE_PLAN_LIMITS: z.enum(["true", "false"]).default("false"),
  RESEND_API_KEY: z.string().default("please-set-your-resend-api-key-here"),
  RESEND_FROM_EMAIL: z.string().default("DocuBite <user@localhost>"),
  // Both halves or nothing: better-auth registers the provider from the pair, and a half-set
  // pair would advertise a Google button that fails at the redirect. See isGoogleAuthEnabled.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_STARTER_PRICE_ID: z.string().default(""),
  STRIPE_GROWTH_PRICE_ID: z.string().default(""),
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
  //   off   — no checking. The default in production, because a false positive here is an outage.
  //   warn  — logs every unscoped query without changing behaviour. The default in development,
  //           and the mode to run in production until the logs are clean.
  //   throw — refuses them. The end state, adopted only once `warn` reports nothing.
  // Staged deliberately: this touches every query in a live app, so it earns its way to `throw`.
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
})

const env = envSchema.parse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== "")))

// The placeholders are long enough to satisfy the schema, so without this a production deploy
// missing these variables would boot happily with a publicly known session signing key and a
// known bearer token for the internal job endpoint.
if (process.env.NODE_ENV === "production") {
  const unset = [
    env.BETTER_AUTH_SECRET === PLACEHOLDER_AUTH_SECRET && "BETTER_AUTH_SECRET",
    env.INTERNAL_WORKER_SECRET === PLACEHOLDER_WORKER_SECRET && "INTERNAL_WORKER_SECRET",
  ].filter((name): name is string => Boolean(name))
  if (unset.length) throw new Error(`Refusing to start in production with default secrets — set ${unset.join(" and ")} to a unique random value.`)
}

/** The Google sign-in button is rendered from this, not from the presence of the plugin: an
 * install without credentials has to boot and simply not offer the option. */
export const isGoogleAuthEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)

const config = {
  app: { title: "DocuBite", description: "DocuBite turns PDFs, scans, photos and handwriting into a live spreadsheet. Every value links back to its source document. Drop in up to 100 files, catch duplicates and gaps, review, then export.", version: packageJson.version || "0.0.1", baseURL: env.BASE_URL, supportEmail: "support@docubite.com" },
  ai: { openaiApiKey: env.OPENAI_API_KEY, openaiModelName: env.OPENAI_MODEL_NAME, geminiApiKey: env.GEMINI_API_KEY, geminiModelName: env.GEMINI_MODEL_NAME, provider: env.AI_PROVIDER },
  documents: { maxFileSizeBytes: 50 * 1024 * 1024, maxPages: env.DOCUMENT_MAX_PAGES, pagesPerBatch: env.DOCUMENT_PAGES_PER_BATCH },
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
  auth: { secret: env.BETTER_AUTH_SECRET, loginUrl: "/login", disableSignup: env.DISABLE_SIGNUP === "true", google: { clientId: env.GOOGLE_CLIENT_ID || "", clientSecret: env.GOOGLE_CLIENT_SECRET || "" } },
  stripe: { secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET, starterPriceId: env.STRIPE_STARTER_PRICE_ID, growthPriceId: env.STRIPE_GROWTH_PRICE_ID },
  // Seats, monthly documents and monthly AI extractions are only actually refused when this is
  // on. lib/plans.ts reads it through here so there is exactly one place that decides.
  billing: { enforcePlanLimits: env.ENFORCE_PLAN_LIMITS === "true" },
  email: { apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL },
  // Tenant isolation. Both default to their safe-for-a-live-app setting; see the env comments for
  // the staged adoption path from `warn` to `throw` to RLS.
  isolation: {
    scopeGuard: env.DB_SCOPE_GUARD ?? (process.env.NODE_ENV === "production" ? "off" : "warn"),
    rlsEnabled: env.DB_RLS_ENABLED === "true",
  },
  // Agnostic dictation (lib/dictation). Off by default and fail-safe by design: with it off, or on
  // any router/extraction failure, a dictation with no pre-selected template still gets the general
  // handler's default format — never a forced route, never a blocked recording.
  dictation: {
    routerEnabled: env.DICTATION_ROUTER_ENABLED === "true",
    routeThreshold: env.DICTATION_ROUTE_THRESHOLD,
    fastModelName: env.DICTATION_FAST_MODEL_NAME || "",
  },
} as const

export default config
