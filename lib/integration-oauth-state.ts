import { createHmac, timingSafeEqual } from "crypto"
import config from "@/lib/config"

/** HMAC-signed, self-contained OAuth `state` tokens for the QuickBooks/Xero connect flow.
 *
 * The provider hands the state param straight back on the callback with no server-side session tied
 * to it, so the state itself has to carry (and authenticate) everything the callback needs to trust:
 * which workspace initiated the connect, which user, which provider, and a short expiry so a stale
 * link cannot be replayed. Modelled on lib/webhook-signature.ts: pure functions, no clock read
 * internally (the caller supplies `now`), HMAC-SHA256, constant-time comparison.
 *
 * Format: base64url(JSON payload) + "." + hex HMAC over that base64url string. The payload carries
 * its own `exp` (unix seconds) rather than relying on the signer's clock at verify time, so a token
 * signed just before expiry cannot be borderline-accepted by a slow verifier. */

export type OAuthStatePayload = {
  workspaceId: string
  userId: string
  provider: "quickbooks" | "xero"
  nonce: string
}

type SignedOAuthState = OAuthStatePayload & { exp: number }

function secret(): string {
  return config.aws.internalWorkerSecret
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url")
}

function base64UrlDecode(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8")
  } catch {
    return null
  }
}

function sign(payloadB64: string): string {
  return createHmac("sha256", secret()).update(payloadB64).digest("hex")
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  } catch {
    return false
  }
}

/** Signs a state token, valid for `ttlSeconds` from `now` (default 10 minutes — long enough to
 * complete the provider's consent screen, short enough that a leaked/logged link goes stale fast). */
export function signOAuthState(payload: OAuthStatePayload, ttlSeconds = 600, now = new Date()): string {
  const signed: SignedOAuthState = { ...payload, exp: Math.floor(now.getTime() / 1000) + ttlSeconds }
  const payloadB64 = base64UrlEncode(JSON.stringify(signed))
  return `${payloadB64}.${sign(payloadB64)}`
}

/** Verifies and decodes a state token. Returns the payload (without `exp`) on success, or null on
 * any failure — malformed token, bad signature, wrong secret, or expiry. Every failure mode collapses
 * to null on purpose: the callback route has nothing more specific to do with any of them than refuse
 * the connect attempt. */
export function verifyOAuthState(token: string, now = new Date()): OAuthStatePayload | null {
  const dot = token.lastIndexOf(".")
  if (dot < 0) return null
  const payloadB64 = token.slice(0, dot)
  const providedSignature = token.slice(dot + 1)
  if (!/^[0-9a-f]+$/i.test(providedSignature)) return null
  if (!safeEqualHex(providedSignature, sign(payloadB64))) return null
  const json = base64UrlDecode(payloadB64)
  if (!json) return null
  let parsed: SignedOAuthState
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (
    typeof parsed !== "object" || parsed === null ||
    typeof parsed.workspaceId !== "string" || typeof parsed.userId !== "string" ||
    (parsed.provider !== "quickbooks" && parsed.provider !== "xero") ||
    typeof parsed.nonce !== "string" || typeof parsed.exp !== "number"
  ) return null
  if (Math.floor(now.getTime() / 1000) > parsed.exp) return null
  const { workspaceId, userId, provider, nonce } = parsed
  return { workspaceId, userId, provider, nonce }
}
