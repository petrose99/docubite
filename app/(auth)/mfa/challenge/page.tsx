import { MfaChallengeForm } from "@/components/auth/mfa-challenge-form"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Verify it's you" }

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export default async function MfaChallengePage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const params = await searchParams
  const next = first(params.next) || "/workspaces"

  return <>
    <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-stone-950">Verify it&apos;s you</h1>
    <p className="mt-1.5 mb-7 text-sm text-stone-500">Enter the code from your authenticator app.</p>
    <MfaChallengeForm next={next} />
  </>
}
