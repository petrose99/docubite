"use client"

import { AuthField, SubmitButton } from "@/components/auth/fields"
import { FormError } from "@/components/forms/error"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import type { Factor } from "@supabase/supabase-js"
import { ShieldCheck, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

/** F1: TOTP enrollment on /settings/security. Three states â€” no factor, enrolling (QR + code
 * shown, unverified until the first correct code), enrolled â€” with an unenroll action once one
 * exists. Supabase supports multiple factors per user; this UI only ever shows one at a time,
 * which matches how the app enforces hipaaMode's aal2 requirement (any verified factor clears it,
 * so there's no product reason to juggle several). */
export function MfaEnroll() {
  const [factors, setFactors] = useState<Factor[] | null>(null)
  const [enrolling, setEnrolling] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    const supabase = createClient()
    const { data } = await supabase.auth.mfa.listFactors()
    setFactors(data?.totp ?? [])
  }

  useEffect(() => { void (async () => { await refresh() })() }, [])

  const startEnroll = async () => {
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp" })
      if (enrollError || !data) { setError("Could not start enrollment. Please try again."); return }
      setEnrolling({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
    } finally { setBusy(false) }
  }

  const confirmEnroll = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!enrolling) return
    setBusy(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: enrolling.factorId })
      if (challengeError || !challenge) { setError("Could not verify that code. Please try again."); return }
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId: enrolling.factorId, challengeId: challenge.id, code: code.trim() })
      if (verifyError) { setError("That code didn't match. Check your authenticator app and try again."); return }
      toast.success("Two-factor authentication is on")
      setEnrolling(null)
      setCode("")
      await refresh()
    } finally { setBusy(false) }
  }

  const unenroll = async (factorId: string) => {
    setBusy(true)
    try {
      const supabase = createClient()
      const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId })
      if (unenrollError) { toast.error("Could not remove that factor"); return }
      toast.success("Two-factor authentication is off")
      await refresh()
    } finally { setBusy(false) }
  }

  if (factors === null) return null

  const active = factors.find((factor) => factor.status === "verified")

  if (active) {
    return <div className="flex items-center justify-between gap-4 rounded border p-4">
      <span className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-emerald-700" />Two-factor authentication is on</span>
      <button type="button" className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50" disabled={busy} onClick={() => void unenroll(active.id)}>
        <Trash2 className="h-3.5 w-3.5" />Turn off
      </button>
    </div>
  }

  if (enrolling) {
    return <form onSubmit={confirmEnroll} className="space-y-3 rounded border p-4">
      <p className="text-sm font-medium">Scan this with your authenticator app</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- data: URI from Supabase, not an optimizable remote image */}
      <img src={enrolling.qrCode} alt="TOTP enrollment QR code" className="h-40 w-40" />
      <p className="text-xs text-slate-500">Can&apos;t scan it? Enter this key instead: <code className="rounded bg-slate-100 px-1 py-0.5">{enrolling.secret}</code></p>
      <AuthField label="Code from your app">
        <Input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" pattern="[0-9]*" maxLength={6} required autoFocus />
      </AuthField>
      <div className="flex gap-2">
        <SubmitButton busy={busy}>{busy ? "Verifyingâ€¦" : "Confirm"}</SubmitButton>
        <button type="button" className="rounded-md border px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => { setEnrolling(null); setCode("") }}>Cancel</button>
      </div>
      {error && <FormError>{error}</FormError>}
    </form>
  }

  return <div className="flex items-center justify-between gap-4 rounded border p-4">
    <span>
      <span className="block font-medium">Two-factor authentication</span>
      <span className="text-sm text-muted-foreground">Add an authenticator app as a second sign-in step. Required for workspaces with HIPAA mode on.</span>
    </span>
    <button type="button" className="shrink-0 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50" disabled={busy} onClick={() => void startEnroll()}>
      {busy ? "Startingâ€¦" : "Turn on"}
    </button>
  </div>
}
