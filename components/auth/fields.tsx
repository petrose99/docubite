"use client"

import { Input } from "@/components/ui/input"
import { Eye, EyeOff } from "lucide-react"
import { useState } from "react"

export function AuthField({ label, action, children }: { label: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1.5">
    <span className="flex items-baseline justify-between gap-3 text-sm font-medium text-slate-800">{label}{action}</span>
    {children}
  </label>
}

/** A show/hide toggle rather than a plain password input: these forms enforce an 8-character
 * minimum and reject the whole submission on a typo, which is a poor trade when the user cannot
 * see what they typed. */
export function PasswordField({ label, name, value, onChange, autoComplete, action, minLength }: {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  autoComplete: "current-password" | "new-password"
  action?: React.ReactNode
  minLength?: number
}) {
  const [visible, setVisible] = useState(false)
  return (
    <AuthField label={label} action={action}>
      <span className="relative block">
        <Input
          name={name}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          minLength={minLength}
          autoComplete={autoComplete}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-400 hover:text-slate-700"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
    </AuthField>
  )
}

export function SubmitButton({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="mt-1 inline-flex h-11 w-full items-center justify-center rounded-lg bg-emerald-700 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40 focus-visible:ring-offset-2 disabled:opacity-60"
    >
      {children}
    </button>
  )
}

export function AuthDivider() {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="h-px flex-1 bg-slate-200" />
      <span className="text-xs font-medium uppercase tracking-[.14em] text-slate-400">or</span>
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  )
}
