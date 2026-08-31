import { ForgotPasswordForm } from "@/components/auth/password-reset-forms"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Forgot your password" }

export default function ForgotPasswordPage() {
  return <>
    <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-slate-950">Forgot your password?</h1>
    <p className="mt-1.5 mb-7 text-sm text-slate-500">Tell us the address on the account and we will send a link to set a new one.</p>
    <ForgotPasswordForm />
  </>
}
