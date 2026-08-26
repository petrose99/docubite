/** Shared error classification for the accounting connectors (QuickBooks + Xero), mirroring
 * lib/document-processing.ts's PERMANENT_ERROR_CODES / safeErrorCode split: a provider failure is
 * either retryable (network blip, rate limit, transient 5xx — worth another attempt after backoff)
 * or permanent (bad request shape, revoked auth — retrying changes nothing). Kept provider-agnostic
 * here; each provider's own errors.ts translates its wire-level status codes into these. */

/** Thrown by a provider client when a call fails because the connection's authorization itself is
 * no longer valid (401 with an invalid/expired/revoked token, or a refresh whose grant was revoked).
 * lib/integration-token-refresh.ts catches this specifically to move the connection to
 * "needs_reauth" instead of treating it as an ordinary retryable failure. */
export class IntegrationAuthError extends Error {}

/** Thrown for a provider failure that will fail identically on every retry — the push is failed
 * immediately (see lib/integration-push-policy.ts's `forceTerminal`) instead of burning its five
 * attempts on something that can never succeed without a person fixing something first (e.g. a
 * default expense account that was deleted at the provider, or a malformed request body). */
export class IntegrationPermanentError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

/** Thrown for a provider failure worth retrying (rate limited, transient server error, timeout). */
export class IntegrationRetryableError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

/** Maps an HTTP response status from either provider's API to the right error class. 401/403 are
 * auth-shaped (IntegrationAuthError); 400/404/422 are permanent (the request itself is wrong);
 * 429/5xx are retryable. Anything else defaults to retryable — an unrecognized status is more likely
 * a transient provider hiccup than a request we can never fix. */
export function classifyHttpStatus(status: number, bodySnippet = ""): Error {
  const code = `http_${status}`
  if (status === 401) return new IntegrationAuthError(code)
  if (status === 403) return new IntegrationAuthError(code)
  if (status === 400 || status === 404 || status === 422) return new IntegrationPermanentError(code)
  if (status === 429 || status >= 500) return new IntegrationRetryableError(code)
  return new IntegrationRetryableError(code + (bodySnippet ? "" : ""))
}

/** Same normalization document-processing.ts uses for a caught error's message, so a push's
 * error_code column stays a short, storable, non-secret token. */
export function safeErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : "integration_push_failed"
  return raw.replace(/[^a-z0-9_]/gi, "_").slice(0, 96).toLowerCase()
}
