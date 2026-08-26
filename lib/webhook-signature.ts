import { createHmac, timingSafeEqual } from "crypto"

/** HMAC-SHA256 signing for outbound webhook deliveries, in the shape receivers already know from
 * Stripe: the signed payload is `${timestamp}.${rawBody}`, and the header carries both so the
 * receiver can (a) recompute the MAC over the exact bytes it received and (b) reject a replayed
 * delivery whose timestamp is too old.
 *
 * Header layout (mirrors Stripe's `Stripe-Signature`):
 *   X-DocuBite-Signature: t=<unix-seconds>,v1=<hex-hmac>
 * `t` and `v1` are the only fields v1 emits; parsers must ignore unknown `k=v` pairs so we can add
 * a `v2=` scheme later without breaking them.
 *
 * The functions here are pure — no clock, no config. The caller supplies the timestamp (so tests
 * are deterministic and the same signed bytes can be re-sent on a retry) and the receiver-side
 * `verifySignature` takes the tolerance and `now` explicitly. */

const SCHEME = "v1"

export function signaturePayload(timestamp: number, rawBody: string): string {
  return `${timestamp}.${rawBody}`
}

export function computeSignature(secret: string, timestamp: number, rawBody: string): string {
  return createHmac("sha256", secret).update(signaturePayload(timestamp, rawBody)).digest("hex")
}

/** The value for the X-DocuBite-Signature header. */
export function buildSignatureHeader(secret: string, timestamp: number, rawBody: string): string {
  return `t=${timestamp},${SCHEME}=${computeSignature(secret, timestamp, rawBody)}`
}

/** Parses `t=...,v1=...` into its fields, ignoring unknown keys. Returns null if `t` is missing
 * or non-numeric — a header we cannot even read a timestamp from is not verifiable. */
export function parseSignatureHeader(header: string): { timestamp: number; v1: string[] } | null {
  const fields = new Map<string, string[]>()
  for (const part of header.split(",")) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (!fields.has(key)) fields.set(key, [])
    fields.get(key)!.push(value)
  }
  const t = fields.get("t")?.[0]
  if (!t || !/^\d+$/.test(t)) return null
  return { timestamp: Number(t), v1: fields.get(SCHEME) ?? [] }
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  } catch {
    return false
  }
}

/** Receiver-side verification. Recomputes the MAC over `${t}.${rawBody}` and compares it, in
 * constant time, against every `v1=` in the header (there can be more than one during a secret
 * rotation). Rejects a delivery whose timestamp is more than `toleranceSeconds` away from `now`
 * (default 5 minutes) to bound replay. `now` is in unix seconds; both it and the tolerance are
 * explicit so this is a pure function. Exported so the API can offer receivers a reference
 * verifier and so it can be unit-tested. */
export function verifySignature(
  secret: string,
  rawBody: string,
  header: string,
  opts: { now: number; toleranceSeconds?: number }
): boolean {
  const parsed = parseSignatureHeader(header)
  if (!parsed) return false
  const tolerance = opts.toleranceSeconds ?? 300
  if (Math.abs(opts.now - parsed.timestamp) > tolerance) return false
  const expected = computeSignature(secret, parsed.timestamp, rawBody)
  return parsed.v1.some((candidate) => safeEqualHex(candidate, expected))
}
