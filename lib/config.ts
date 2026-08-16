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
  app: { title: "DocuBite", description: "Take a bite out of document busywork. DocuBite reads invoices, receipts, bank statements and IDs — even handwritten and scanned ones — and hands back clean, reviewed data.", version: packageJson.version || "0.0.1", baseURL: env.BASE_URL, supportEmail: "support@docubite.com" },
  ai: { openaiApiKey: env.OPENAI_API_KEY, openaiModelName: env.OPENAI_MODEL_NAME, geminiApiKey: env.GEMINI_API_KEY, geminiModelName: env.GEMINI_MODEL_NAME, provider: env.AI_PROVIDER },
  documents: { maxFileSizeBytes: 50 * 1024 * 1024, maxPages: env.DOCUMENT_MAX_PAGES, pagesPerBatch: env.DOCUMENT_PAGES_PER_BATCH },
  mineru: { apiToken: env.MINERU_API_TOKEN || "", apiBase: env.MINERU_API_BASE.replace(/\/+$/, ""), modelVersion: env.MINERU_MODEL_VERSION, pollIntervalMs: env.MINERU_POLL_INTERVAL_MS, timeoutMs: env.MINERU_TIMEOUT_MS },
  aws: { region: env.AWS_REGION, documentsBucket: env.AWS_S3_DOCUMENTS_BUCKET, kmsKeyId: env.AWS_S3_KMS_KEY_ID, internalWorkerSecret: env.INTERNAL_WORKER_SECRET, malwareScanUrl: env.MALWARE_SCAN_URL },
  auth: { secret: env.BETTER_AUTH_SECRET, loginUrl: "/login", disableSignup: env.DISABLE_SIGNUP === "true", google: { clientId: env.GOOGLE_CLIENT_ID || "", clientSecret: env.GOOGLE_CLIENT_SECRET || "" } },
  stripe: { secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET, starterPriceId: env.STRIPE_STARTER_PRICE_ID, growthPriceId: env.STRIPE_GROWTH_PRICE_ID },
  // Seats, monthly documents and monthly AI extractions are only actually refused when this is
  // on. lib/plans.ts reads it through here so there is exactly one place that decides.
  billing: { enforcePlanLimits: env.ENFORCE_PLAN_LIMITS === "true" },
  email: { apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL },
} as const

export default config
