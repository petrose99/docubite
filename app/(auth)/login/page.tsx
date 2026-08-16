import { LoginForm } from "@/components/auth/login-form"
import { isGoogleAuthEnabled } from "@/lib/config"
import { parseInviteToken } from "@/lib/invite-token"
import { getInvitationEmailForToken } from "@/models/workspaces"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Sign in" }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ invite?: string | string[] }> }) {
  const { invite } = await searchParams
  // Shape-validated server-side before it is ever used — see lib/invite-token.ts for why this
  // is the thing standing between `?invite=` and an open redirect.
  const token = parseInviteToken(Array.isArray(invite) ? invite[0] : invite)
  const invitedEmail = token ? await getInvitationEmailForToken(token) : null
  const inviteQuery = token ? `?invite=${encodeURIComponent(token)}` : ""

  return <>
    <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-stone-950">Sign in to DocuBite</h1>
    <p className="mt-1.5 mb-7 text-sm text-stone-500">
      {invitedEmail ? <>Sign in as <strong className="font-medium text-stone-700">{invitedEmail}</strong> and you will join the workspace you were invited to.</> : "Welcome back."}
    </p>

    <LoginForm
      defaultEmail={invitedEmail || undefined}
      redirectTo={token ? `/invite/${token}` : "/workspaces"}
      googleEnabled={isGoogleAuthEnabled}
      signupHref={`/signup${inviteQuery}`}
    />
  </>
}
