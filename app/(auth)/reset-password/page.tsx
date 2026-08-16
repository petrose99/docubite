import { ResetPasswordForm } from "@/components/auth/password-reset-forms"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Choose a new password" }

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams
  const value = Array.isArray(token) ? token[0] : token

  return <>
    <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-stone-950">Choose a new password</h1>
    <p className="mt-1.5 mb-7 text-sm text-stone-500">Pick something you have not used here before.</p>
    <ResetPasswordForm token={value || null} />
  </>
}
