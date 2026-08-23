"use client"

import { AuthField, SubmitButton } from "@/components/auth/fields"
import { FormError } from "@/components/forms/error"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import { useEffect, useState } from "react"

/** The second step of login for an account with TOTP enrolled — reached from login-form.tsx when
 * getAuthenticatorAssuranceLevel() reports the session is still aal1. Nothing to type an email or
 * password into here: the aal1 session from the first step is what lets listFactors() and
 * challengeAndVerify() identify the account at all, so a visitor who never completed step one has
 * nothing to challenge and is bounced back to /login. */
export function MfaChallengeForm({ next = "/workspaces" }: { next?: string }) {
  const [factorId, setFactorId] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const { data } = await supabase.auth.mfa.listFactors()
      const factor = data?.totp?.find((candidate) => candidate.status === "verified")
      if (!factor) { window.location.href = "/login"; return }
      setFactorId(factor.id)
      setReady(true)
    })()
  }, [])

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!factorId) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
      if (verifyError) { setError("That code didn't match. Check your authenticator app and try again."); return }
      window.location.href = next
    } catch {
      setError("Could not verify that code. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  if (!ready) return null

  return <form onSubmit={onSubmit} className="flex flex-col gap-4">
    <AuthField label="Code from your authenticator app">
      <Input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" pattern="[0-9]*" maxLength={6} required autoFocus autoComplete="one-time-code" />
    </AuthField>
    <SubmitButton busy={busy}>{busy ? "Verifying…" : "Verify"}</SubmitButton>
    {error && <FormError>{error}</FormError>}
  </form>
}
