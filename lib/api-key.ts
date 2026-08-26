import { createHash, randomBytes, timingSafeEqual } from "crypto"

/** API keys for the public /api/v1 surface. Same store-only-the-hash posture as invitation tokens
 * (models/workspaces.ts): the plaintext key is shown to the user exactly once, and only its sha256
 * is persisted, so a database leak never yields a usable key.
 *
 * A key looks like `dbk_live_<40 base64url chars>`. The `dbk_live_` prefix is a human- and
 * scanner-friendly label (GitHub secret scanning keys off such prefixes), and the FIRST 8 chars of
 * the random part are stored separately as `keyPrefix` (`dbk_live_a1b2c3d4`) so the settings UI can
 * name a key without holding the secret. The whole string is hashed for lookup. */

const KEY_PREFIX = "dbk_live_"
const SECRET_BYTES = 30 // 30 bytes -> 40 base64url chars
// The visible label = prefix + first 8 chars of the secret. Enough to disambiguate keys in a list
// without being enough to guess the remaining 32 chars.
const LABEL_SECRET_CHARS = 8

export type GeneratedApiKey = {
  /** The full secret. Returned once, never stored. */
  plaintext: string
  /** sha256(plaintext) hex — what goes in WorkspaceApiKey.keyHash. */
  keyHash: string
  /** Non-secret display label, e.g. "dbk_live_a1b2c3d4" — what goes in WorkspaceApiKey.keyPrefix. */
  keyPrefix: string
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex")
}

export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(SECRET_BYTES).toString("base64url")
  const plaintext = KEY_PREFIX + secret
  return { plaintext, keyHash: hashApiKey(plaintext), keyPrefix: KEY_PREFIX + secret.slice(0, LABEL_SECRET_CHARS) }
}

/** Extracts the bearer token from an Authorization header value, or null. Case-insensitive scheme,
 * tolerant of extra whitespace. Does NOT validate the token's shape beyond being non-empty — that
 * is the hash lookup's job. */
export function parseBearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(authorization)
  return match ? match[1] : null
}

/** True only for something shaped like one of our keys. Cheap pre-filter so a malformed Authorization
 * header is rejected before it reaches the database. */
export function looksLikeApiKey(token: string): boolean {
  return /^dbk_live_[A-Za-z0-9_-]{40}$/.test(token)
}

/** Constant-time comparison of two sha256 hex digests, for callers that compare a computed hash to
 * a stored one without going through a unique-index lookup. */
export function apiKeyHashEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  } catch {
    return false
  }
}
