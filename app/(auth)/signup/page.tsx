import { SignupForm } from "@/components/auth/signup-form"
import { isGoogleAuthEnabled } from "@/lib/config"
import { parseInviteToken } from "@/lib/invite-token"
import { TRIAL_DAYS, WORKSPACE_PLANS } from "@/lib/plans"
import { getInvitationEmailForToken } from "@/models/workspaces"
import type { Metadata } from "next"

export const metadata: Metadata = { title: "Start your free trial" }

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ email?: string | string[]; plan?: string | string[]; invite?: string | string[] }> }) {
  const params = await searchParams
  const token = parseInviteToken(first(params.invite))
  const invitedEmail = token ? await getInvitationEmailForToken(token) : null
  // `?email=` comes from the marketing email-capture forms. Only used to prefill a field the
  // user can still edit, so a nonsense value costs nothing — but an invited address wins, since
  // the invitation only accepts the exact address it was issued to.
  const prefilledEmail = invitedEmail || first(params.email)
  // Informational only: the workspace is created lazily on the first /workspaces visit and every
  // trial starts on the same footing. Naming the plan here keeps the pricing-page click honest
  // instead of silently dropping it.
  const plan = WORKSPACE_PLANS[first(params.plan) || ""]
  const inviteQuery = token ? `?invite=${encodeURIComponent(token)}` : ""

  return <>
    <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-stone-950">
      {invitedEmail ? "Join the workspace" : `Start your ${TRIAL_DAYS}-day free trial`}
    </h1>
    <p className="mt-1.5 mb-7 text-sm text-stone-500">
      {invitedEmail
        ? <>Create your account for <strong className="font-medium text-stone-700">{invitedEmail}</strong> to accept the invitation.</>
        : plan
          ? <>You picked <strong className="font-medium text-stone-700">{plan.name}</strong>. No credit card now — add one from Billing whenever you are ready.</>
          : "No credit card required. Cancel any time."}
    </p>

    <SignupForm
      defaultEmail={prefilledEmail}
      redirectTo={token ? `/invite/${token}` : "/workspaces"}
      googleEnabled={isGoogleAuthEnabled}
      loginHref={`/login${inviteQuery}`}
    />
  </>
}
