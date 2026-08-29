import config from "@/lib/config"
import { assertSignupAllowed } from "@/lib/signup-gate"
import { Webhook } from "standardwebhooks"

/** The target of Supabase's "Before User Created" Auth Hook (configured in the Supabase dashboard
 * under Authentication → Hooks, HTTP hook, pointed at this route's URL) — this is the primary
 * DISABLE_SIGNUP control, and the only one in front of the Google OAuth signup path, which has no
 * server action of ours in the middle of it the way password signup does (see signUpAction in
 * app/(auth)/auth-actions.ts, which runs the same check as a faster, more reliable pre-check on
 * that one path).
 *
 * VERIFY LIVE BEFORE RELYING ON THIS: an open report (supabase/supabase#38751) says the documented
 * rejection response is sometimes not honored by GoTrue. Confirm signup is actually blocked
 * end-to-end against a real project — see the HIPAA migration plan's Verification section — before
 * treating this route as the real gate rather than resolveOrProvisionUser's suspend-on-provision
 * fallback (models/users.ts).
 *
 * Request/response shapes per Supabase's docs: the incoming payload is signed with the Standard
 * Webhooks spec (verified below with the project's Auth Hook secret, not the internal-worker
 * bearer pattern used elsewhere in this codebase — Supabase's hook delivery doesn't carry an
 * Authorization header at all), `{}` (or 204) allows the signup, and
 * `{ "error": { "http_code": ..., "message": ... } }` denies it. */
export async function POST(request: Request) {
  if (!config.supabase.authHookSecret) return Response.json({ error: { http_code: 500, message: "signup_hook_not_configured" } }, { status: 500 })

  const body = await request.text()
  try {
    const secret = config.supabase.authHookSecret
    const webhook = new Webhook(secret.startsWith("v1,") ? secret.slice(3) : secret)
    webhook.verify(body, Object.fromEntries(request.headers))
  } catch {
    return Response.json({ error: { http_code: 401, message: "invalid_signature" } }, { status: 401 })
  }

  let email: string | undefined
  try {
    email = JSON.parse(body)?.user?.email
  } catch {
    return Response.json({ error: { http_code: 400, message: "invalid_payload" } }, { status: 400 })
  }
  if (!email) return Response.json({ error: { http_code: 400, message: "invalid_payload" } }, { status: 400 })

  try {
    await assertSignupAllowed(email)
    return Response.json({})
  } catch {
    return Response.json({ error: { http_code: 400, message: "Sign-up is disabled" } })
  }
}
