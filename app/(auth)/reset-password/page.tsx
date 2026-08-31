import { ResetPasswordForm } from "@/components/auth/password-reset-forms"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Choose a new password" }

// No searchParams read here anymore — the code that used to arrive as ?token= is consumed by
// /auth/callback before it ever redirects to this page, exchanged there for a recovery session.
export default function ResetPasswordPage() {
  return <>
    <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-slate-950">Choose a new password</h1>
    <p className="mt-1.5 mb-7 text-sm text-slate-500">Pick something you have not used here before.</p>
    <ResetPasswordForm />
  </>
}
