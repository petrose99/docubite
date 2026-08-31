"use client"

import { requestPasswordResetAction } from "@/app/(auth)/auth-actions"
import { AuthField, PasswordField, SubmitButton } from "@/components/auth/fields"
import { FormError } from "@/components/forms/error"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import { MailCheck } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

const MIN_PASSWORD_LENGTH = 12

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // Routed through a server action, not the browser client directly, so the F14 rate-limit
      // backstop (lib/rate-limit.ts) can run first. /auth/callback exchanges the code the email
      // link carries for a recovery session, then forwards here â€” see that route and
      // ResetPasswordForm below, which expects that session to already exist rather than taking a
      // bare token the way better-auth's reset did.
      await requestPasswordResetAction(email)
      // Shown whatever came back. A distinct "no such account" response would let anyone test
      // which addresses are registered, and requestPasswordResetAction already answers uniformly
      // for that reason â€” success regardless of whether the account exists or the limit was hit.
      setSent(true)
    } catch {
      setError("Could not send the reset link. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="text-center">
        <MailCheck className="mx-auto h-9 w-9 text-emerald-700" strokeWidth={1.6} />
        <h2 className="mt-4 font-display text-xl font-bold tracking-[-0.02em] text-slate-900">Check your email</h2>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-600">
          If <strong className="font-medium text-slate-800">{email}</strong> has an account, a link to choose a new password is on its way. It expires in an hour.
        </p>
        <Link href="/login" className="mt-6 inline-block text-sm font-semibold text-emerald-800 hover:underline">Back to sign in</Link>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <AuthField label="Email">
        <Input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" autoFocus />
      </AuthField>
      <SubmitButton busy={busy}>{busy ? "Sendingâ€¦" : "Email me a reset link"}</SubmitButton>
      {error && <FormError>{error}</FormError>}
      <p className="text-center text-sm text-slate-500">
        Remembered it? <Link href="/login" className="font-semibold text-emerald-800 hover:underline">Sign in</Link>
      </p>
    </form>
  )
}

/** No `token` prop, unlike the better-auth version: this page only ever renders after
 * /auth/callback has already exchanged the email link's code for a recovery session (cookies are
 * already set by the time this component mounts), so there is nothing left to pass in â€” the
 * updateUser call below reads that session the same way any other authenticated request would. */
export function ResetPasswordForm() {
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError("This link has expired or has already been used. Request a new one.")
        return
      }
      // Straight to sign-in, not the workspace: updateUser leaves the recovery-scoped session in
      // place, which is narrower than a normal sign-in â€” going through /login mints an ordinary one.
      window.location.href = "/login"
    } catch {
      setError("Could not set that password. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <PasswordField label="New password" name="password" value={password} onChange={setPassword} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} />
      <p className="-mt-2 text-xs text-slate-500">At least {MIN_PASSWORD_LENGTH} characters.</p>
      <SubmitButton busy={busy}>{busy ? "Savingâ€¦" : "Set new password"}</SubmitButton>
      {error && <FormError>{error}</FormError>}
    </form>
  )
}
