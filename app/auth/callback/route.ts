import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

/** One handler for both redirect flows that carry a code needing exchange for a session: Google
 * OAuth (from google-button.tsx) and password-recovery email links (from
 * ForgotPasswordForm.resetPasswordForEmail). Supabase's redirect always includes `code`; `next`
 * is our own param carrying where to land afterward — /reset-password for recovery,
 * /workspaces (or an invite link) for OAuth.
 *
 * `type=recovery` on the URL is a signal, not a security boundary: exchangeCodeForSession is what
 * actually establishes the session in both cases, and a recovery code exchanged here is scoped by
 * Supabase itself to permit only updateUser({ password }), not full account access. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const next = url.searchParams.get("next") || "/workspaces"

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(next, url.origin))
  }

  return NextResponse.redirect(new URL("/login?error=auth_callback_failed", url.origin))
}
