"use client"

import { AuthDivider, AuthField, PasswordField, SubmitButton } from "@/components/auth/fields"
import { GoogleButton } from "@/components/auth/google-button"
import { FormError } from "@/components/forms/error"
import { Input } from "@/components/ui/input"
import { authClient } from "@/lib/auth-client"
import type { Route } from "next"
import Link from "next/link"
import { useState } from "react"

const MIN_PASSWORD_LENGTH = 8

/** Surfaces the DISABLE_SIGNUP gate as something a person can act on. assertSignupAllowed throws
 * an APIError with this message from inside the user.create hook, so it arrives here as an
 * ordinary failed response rather than as anything the form can predict in advance. */
const friendlyError = (message?: string) => {
  if (!message) return "Could not create your account. Please try again."
  if (/sign-?up is disabled/i.test(message)) return "Sign-up is closed right now. Ask for an invitation, or contact us for access."
  if (/already exists|existing user|already registered/i.test(message)) return "An account with that email already exists — sign in instead."
  return message
}

export function SignupForm({ defaultEmail, redirectTo = "/workspaces", googleEnabled, loginHref = "/login" }: {
  defaultEmail?: string
  redirectTo?: string
  googleEnabled: boolean
  loginHref?: string
}) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState(defaultEmail || "")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await authClient.signUp.email({ name, email, password })
      if (result.error) {
        setError(friendlyError(result.error.message))
        return
      }
      // Hard navigation for the same reason as the login form: the workspace is created lazily on
      // the first /workspaces visit, and that has to run against the new session cookie.
      window.location.href = redirectTo
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : undefined))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {googleEnabled && <>
        <GoogleButton callbackURL={redirectTo} label="Sign up with Google" onError={(message) => setError(message || null)} />
        <AuthDivider />
      </>}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <AuthField label="Your name">
          <Input name="name" value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" autoFocus />
        </AuthField>

        <AuthField label="Work email">
          <Input name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
        </AuthField>

        <PasswordField label="Password" name="password" value={password} onChange={setPassword} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} />
        <p className="-mt-2 text-xs text-stone-500">At least {MIN_PASSWORD_LENGTH} characters.</p>

        <SubmitButton busy={busy}>{busy ? "Creating your workspace…" : "Start free trial"}</SubmitButton>

        {error && <FormError>{error}</FormError>}
      </form>

      <p className="text-center text-sm text-stone-500">
        Already have an account? <Link href={loginHref as Route} className="font-semibold text-emerald-800 hover:underline">Sign in</Link>
      </p>
    </div>
  )
}
