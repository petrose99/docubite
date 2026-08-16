"use client"

import { AuthDivider, AuthField, PasswordField, SubmitButton } from "@/components/auth/fields"
import { GoogleButton } from "@/components/auth/google-button"
import { FormError } from "@/components/forms/error"
import { Input } from "@/components/ui/input"
import { authClient } from "@/lib/auth-client"
import type { Route } from "next"
import Link from "next/link"
import { useState } from "react"

export function LoginForm({ defaultEmail, redirectTo = "/workspaces", googleEnabled, signupHref = "/signup" }: {
  defaultEmail?: string
  redirectTo?: string
  googleEnabled: boolean
  signupHref?: string
}) {
  const [email, setEmail] = useState(defaultEmail || "")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await authClient.signIn.email({ email, password })
      if (result.error) {
        // Deliberately one message for both "no such account" and "wrong password": telling them
        // apart turns this form into an oracle for which addresses have accounts.
        setError("That email and password do not match an account.")
        return
      }
      // A hard navigation, not router.push: the session cookie was minted a moment ago, and a
      // client-side push would render the destination against the session-less cached payload —
      // which on /invite/[token] shows "Invitation unavailable" to someone who just signed in.
      window.location.href = redirectTo
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign you in. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {googleEnabled && <>
        <GoogleButton callbackURL={redirectTo} onError={(message) => setError(message || null)} />
        <AuthDivider />
      </>}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <AuthField label="Email">
          <Input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" autoFocus={!defaultEmail} />
        </AuthField>

        <PasswordField
          label="Password"
          name="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          action={<Link href="/forgot-password" className="text-sm font-medium text-emerald-800 hover:underline">Forgot password?</Link>}
        />

        <SubmitButton busy={busy}>{busy ? "Signing in…" : "Sign in"}</SubmitButton>

        {error && <FormError>{error}</FormError>}
      </form>

      <p className="text-center text-sm text-stone-500">
        New here? <Link href={signupHref as Route} className="font-semibold text-emerald-800 hover:underline">Create an account</Link>
      </p>
    </div>
  )
}
