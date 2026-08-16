"use client"

import { AuthField, PasswordField, SubmitButton } from "@/components/auth/fields"
import { FormError } from "@/components/forms/error"
import { Input } from "@/components/ui/input"
import { authClient } from "@/lib/auth-client"
import { MailCheck } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

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
      await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" })
      // Shown whatever came back. A distinct "no such account" response would let anyone test
      // which addresses are registered, and better-auth already answers uniformly for that reason.
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
        <h2 className="mt-4 font-display text-xl font-bold tracking-[-0.02em] text-stone-900">Check your email</h2>
        <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-stone-600">
          If <strong className="font-medium text-stone-800">{email}</strong> has an account, a link to choose a new password is on its way. It expires in an hour.
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
      <SubmitButton busy={busy}>{busy ? "Sending…" : "Email me a reset link"}</SubmitButton>
      {error && <FormError>{error}</FormError>}
      <p className="text-center text-sm text-stone-500">
        Remembered it? <Link href="/login" className="font-semibold text-emerald-800 hover:underline">Sign in</Link>
      </p>
    </form>
  )
}

export function ResetPasswordForm({ token }: { token: string | null }) {
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!token) {
    return (
      <div className="text-center">
        <p className="text-sm leading-6 text-stone-600">This reset link is missing its token, which usually means it was truncated by an email client.</p>
        <Link href="/forgot-password" className="mt-6 inline-block text-sm font-semibold text-emerald-800 hover:underline">Request a new link</Link>
      </div>
    )
  }

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await authClient.resetPassword({ newPassword: password, token })
      if (result.error) {
        setError("This link has expired or has already been used. Request a new one.")
        return
      }
      // Straight to sign-in: resetPassword does not mint a session, so there is nothing to
      // preserve by staying on the client here.
      window.location.href = "/login"
    } catch {
      setError("Could not set that password. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <PasswordField label="New password" name="password" value={password} onChange={setPassword} autoComplete="new-password" minLength={8} />
      <p className="-mt-2 text-xs text-stone-500">At least 8 characters.</p>
      <SubmitButton busy={busy}>{busy ? "Saving…" : "Set new password"}</SubmitButton>
      {error && <FormError>{error}</FormError>}
    </form>
  )
}
