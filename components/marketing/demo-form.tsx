"use client"

import { submitDemoRequest } from "@/app/(marketing)/demo/actions"
import { VOLUME_OPTIONS } from "@/app/(marketing)/demo/volume-options"
import { FormError } from "@/components/forms/error"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { CheckCircle2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="flex flex-col gap-1.5">
    <span className="text-sm font-medium text-stone-800">{label}</span>
    {children}
    {hint && <span className="text-xs text-stone-500">{hint}</span>}
  </label>
}

export function DemoForm() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  if (sent) {
    return (
      <div className="rounded-[2rem] rounded-tr-md border border-emerald-200 bg-emerald-50 p-8 text-center">
        <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-700" strokeWidth={1.6} />
        <h2 className="mt-4 font-display text-2xl font-bold tracking-[-0.02em] text-stone-900">Request received</h2>
        <p className="mx-auto mt-2 max-w-sm leading-7 text-stone-600">
          We will reply from the support inbox within one business day to find a time. Bring your most awkward document.
        </p>
      </div>
    )
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await submitDemoRequest(new FormData(event.currentTarget))
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSent(true)
      toast.success("Demo request sent — we will be in touch shortly")
    } catch {
      setError("Something went wrong sending that. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-[2rem] rounded-tr-md border border-stone-200 bg-white p-6 shadow-[0_28px_70px_-48px_rgba(41,37,36,.5)] sm:p-8">
      <Field label="Your name"><Input name="name" required autoComplete="name" placeholder="Alex Moreau" /></Field>
      <Field label="Work email"><Input name="email" type="email" required autoComplete="email" placeholder="alex@yourfirm.com" /></Field>
      <Field label="Company"><Input name="company" required autoComplete="organization" placeholder="Moreau &amp; Co Bookkeeping" /></Field>
      <Field label="Monthly document volume">
        <NativeSelect name="volume" defaultValue={VOLUME_OPTIONS[1]} className="w-full">
          {VOLUME_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Anything we should look at?" hint="Optional — the document type that gives you the most trouble is the most useful thing to tell us.">
        <Textarea name="message" rows={4} placeholder="We process about 400 handwritten delivery notes a month…" />
      </Field>

      {/* Honeypot: hidden from people, filled in by bots. See submitDemoRequest. */}
      <div aria-hidden className="hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <button
        type="submit"
        disabled={busy}
        className="mt-2 inline-flex h-11 items-center justify-center rounded-lg bg-emerald-700 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800 disabled:opacity-60"
      >
        {busy ? "Sending…" : "Request a demo"}
      </button>

      {error && <FormError>{error}</FormError>}
    </form>
  )
}
