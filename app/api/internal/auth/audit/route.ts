import { getApiUser } from "@/lib/auth"
import { recordAdminAudit } from "@/lib/auth-audit"
import { checkRequestRateLimit } from "@/lib/rate-limit"

/** Client-reported auth events (SOC 2 P2B) — the server has no visibility into the client-side
 * Supabase SDK calls (signInWithPassword, signOut, mfa.verify, ...), so the client tells us after
 * the fact. The event type is checked against an allowlist and detail is limited to a handful of
 * known, non-sensitive keys per type — this endpoint must never become a way for the client to
 * write arbitrary AdminAuditEvent rows.
 *
 * Login success/logout/MFA/password-change require an active session (the whole point is to
 * attribute the event to a real actor); a failed login has no session by definition, so it is the
 * one type accepted unauthenticated — rate-limited harder than the rest since it's the one route a
 * scripted client could hit without ever succeeding. */

const AUTHENTICATED_EVENTS = new Set(["auth_login_success", "auth_logout", "auth_mfa_enrolled", "auth_mfa_unenrolled", "auth_password_changed"])
const UNAUTHENTICATED_EVENTS = new Set(["auth_login_failed"])
const ALL_EVENTS = new Set([...AUTHENTICATED_EVENTS, ...UNAUTHENTICATED_EVENTS])

/** Only these keys are ever persisted, and only as strings — everything else the client sends is
 * dropped rather than passed through to `detail`. */
const ALLOWED_DETAIL_KEYS = new Set(["email", "method", "reason"])

function sanitizeDetail(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== "object") return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (ALLOWED_DETAIL_KEYS.has(key) && typeof value === "string") out[key] = value.slice(0, 200)
  }
  return Object.keys(out).length ? out : undefined
}

export async function POST(request: Request) {
  const rateLimit = await checkRequestRateLimit("auth_client_event", 30, 15 * 60_000)
  if (!rateLimit) return Response.json({ error: "rate_limited" }, { status: 429 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "invalid_payload" }, { status: 400 })
  }

  const type = (body as { type?: unknown })?.type
  if (typeof type !== "string" || !ALL_EVENTS.has(type)) return Response.json({ error: "invalid_event_type" }, { status: 400 })

  const detail = sanitizeDetail((body as { detail?: unknown })?.detail)

  if (AUTHENTICATED_EVENTS.has(type)) {
    const user = await getApiUser()
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    await recordAdminAudit({ actorId: user.id, type, targetUserId: user.id, detail })
    return Response.json({ success: true })
  }

  // auth_login_failed: no session to attribute this to.
  await recordAdminAudit({ type, detail })
  return Response.json({ success: true })
}
