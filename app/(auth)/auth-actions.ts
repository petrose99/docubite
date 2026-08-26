"use server"

import { ActionState } from "@/lib/actions"
import config from "@/lib/config"
import { checkRequestRateLimit } from "@/lib/rate-limit"
import { assertSignupAllowed } from "@/lib/signup-gate"
import { createClient } from "@/lib/supabase/server"

const FIFTEEN_MINUTES_MS = 15 * 60_000
const ONE_HOUR_MS = 60 * 60_000

/** Password sign-up, routed through a server action rather than the browser Supabase client
 * directly — two reasons. First, it lets assertSignupAllowed run as a fast, predictable pre-check
 * with its own error message, rather than relying solely on the "Before User Created" Auth Hook,
 * which has an open report of not always honoring its rejection response (see lib/signup-gate.ts
 * and the HIPAA migration plan's Verification section) — the Hook still runs too and is still the
 * real gate for the Google OAuth path, which has no server action in front of it. Second, it
 * replaces the old friendlyError() regex that string-matched better-auth's message text: that
 * approach cannot survive a provider swap, so this returns a stable, typed error code instead. */
export async function signUpAction(input: { name: string; email: string; password: string }): Promise<ActionState<null>> {
  // 10 signups per IP per hour — generous for a real visitor, tight enough to blunt a scripted
  // flood, and independent of whether Supabase's own limiter (config.toml [auth.rate_limit]) is
  // actually enforced in this project.
  if (!(await checkRequestRateLimit("signup", 10, ONE_HOUR_MS))) return { success: false, error: "rate_limited" }

  const email = input.email.trim().toLowerCase()
  try {
    await assertSignupAllowed(email)
  } catch {
    return { success: false, error: "signup_disabled" }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password: input.password,
    options: { data: { name: input.name.trim() } },
  })
  if (error) {
    if (error.code === "user_already_exists") return { success: false, error: "account_exists" }
    return { success: false, error: "signup_failed" }
  }
  return { success: true, data: null }
}

/** Same rate-limit reasoning as signUpAction. Always reports success regardless of the outcome —
 * ForgotPasswordForm shows one "check your email" message whatever happens, the same
 * no-account-oracle rule the rest of the auth flow follows, so a rate-limit hit here must not
 * produce a visibly different response than an ordinary request would. */
export async function requestPasswordResetAction(email: string): Promise<ActionState<null>> {
  // 5 per IP per 15 minutes — tighter than signup, since a reset email is also this app's own
  // outbound-mail budget being spent (via lib/email.ts's Resend wiring for the bulk-migration
  // path; ordinary resets still go through Supabase's own mailer).
  if (await checkRequestRateLimit("password_reset", 5, FIFTEEN_MINUTES_MS)) {
    const supabase = await createClient()
    await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${config.app.baseURL}/auth/callback?next=${encodeURIComponent("/reset-password")}`,
    }).catch(() => {})
  }
  return { success: true, data: null }
}
