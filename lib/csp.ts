/** Content-Security-Policy string builder for proxy.ts, kept as pure functions so the policy
 * itself is unit-testable without a request/response.
 *
 * connect-src/img-src/etc are deliberately 'self'-only: nothing in the client bundle calls a
 * third-party API directly — the AI providers, MinerU, embeddings, Stripe, and Sentry (via its
 * same-origin /monitoring tunnel) are all reached server-side. If a future integration needs the
 * browser to talk to a new origin directly, add it here explicitly rather than widening the
 * default. */

/** A fresh per-request nonce, generated with the Web Crypto API rather than Node's `crypto`
 * module: proxy.ts runs in the Edge runtime, which has the former globally but not the latter. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** `'strict-dynamic'` on script-src means only the nonce-carrying `<script>` tags Next.js itself
 * emits may run, and everything they in turn load is trusted transitively — no separate allowlist
 * of script origins to maintain as the bundle changes. style-src keeps 'unsafe-inline' because
 * Tailwind's runtime style injection has no nonce hook; that is a materially smaller risk than
 * unrestricted script-src, which is why script-src is what this migration tightens first. */
export function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "report-uri /api/csp-report",
  ].join("; ")
}
