import { UpgradePlanButton } from "@/components/workspace/upgrade-plan-button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getCurrentUser } from "@/lib/auth"
import { getWorkspacePlan, PLAN_LIMITS_ENFORCED, WORKSPACE_PLANS } from "@/lib/plans"
import { prisma } from "@/lib/db"
import { getWorkspaceUsage, requireWorkspaceRole } from "@/models/workspaces"
import { Check, Clock } from "lucide-react"

const dateLabel = (value: Date | null | undefined) => (value ? value.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—")

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  return <div className="space-y-1">
    <div className="flex items-baseline justify-between text-sm">
      <span className="font-medium text-stone-700">{label}</span>
      <span className="text-stone-500">{limit < 0 ? `${used.toLocaleString()} used` : `${used.toLocaleString()} of ${limit.toLocaleString()} used this month`}</span>
    </div>
    <div className="h-2 overflow-hidden rounded-full bg-stone-200">
      <div className={`h-full rounded-full ${percent >= 90 ? "bg-red-500" : "bg-emerald-600"}`} style={{ width: `${limit < 0 ? 4 : Math.max(percent, 2)}%` }} />
    </div>
  </div>
}

/** The trial strip on the Current plan card.
 *
 * The expired branch reports what consumeWorkspaceQuota is actually doing — it throws
 * `trial_expired` past this date — so the wording follows PLAN_LIMITS_ENFORCED rather than
 * claiming a workspace is paused on a deployment where nothing is enforced. */
function TrialNotice({ trialEndsAt, status, hasSubscription, now }: { trialEndsAt: Date | null; status: string; hasSubscription: boolean; now: Date }) {
  if (hasSubscription || status !== "trialing" || !trialEndsAt) return null
  // `now` is passed in rather than read here so the whole card is rendered against one instant.
  const daysLeft = Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86_400_000)

  if (daysLeft <= 0) {
    return PLAN_LIMITS_ENFORCED
      ? <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-semibold text-red-900">Trial ended</p>
          <p className="mt-0.5 text-sm text-red-800">Uploads and AI are paused until you choose a plan. Your documents and data are untouched — everything you already have stays readable and exportable.</p>
        </div>
      : <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">Trial ended</p>
          <p className="mt-0.5 text-sm text-amber-800">Your documents and data are untouched. Choose a plan below to carry on.</p>
        </div>
  }

  return <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
    <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
      <Clock className="h-4 w-4" />Trial — {daysLeft} {daysLeft === 1 ? "day" : "days"} left
    </p>
    <p className="mt-0.5 text-sm text-emerald-800">Ends {dateLabel(trialEndsAt)}. Add a payment method whenever you are ready — the remaining days carry over.</p>
  </div>
}

/** Lido's Billing & Usage: a Current Plan card and a Plan Usage card. The Stripe checkout and
 * portal routes have existed since the beginning with no UI link anywhere; this is that link. */
export default async function BillingPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)
  const [subscription, usage] = await Promise.all([
    prisma.workspaceSubscription.findUnique({ where: { workspaceId } }),
    getWorkspaceUsage(workspaceId),
  ])
  const plan = getWorkspacePlan(subscription?.planCode || "starter")
  const owner = membership.role === "owner"
  const upgrades = Object.values(WORKSPACE_PLANS).filter((candidate) => candidate.code !== plan.code && candidate.priceId)

  const now = new Date()
  const periodStart = subscription?.currentPeriodStart ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const periodEnd = subscription?.currentPeriodEnd ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))

  return <main className="space-y-6">
    <header>
      <h1 className="text-3xl font-bold">Billing &amp; Usage</h1>
      <p className="mt-1 text-muted-foreground">{membership.workspace.name}</p>
    </header>

    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Current plan</CardTitle>
          <CardDescription>
            {plan.name} · {plan.price < 0 ? "Custom pricing" : `$${plan.price}/month`}
            <br />
            {/* A cancelled-in-the-portal subscription is still `active` and still has a period
              * end, so "Renews …" would be exactly wrong on the one card where it matters. */}
            {subscription?.cancelAtPeriodEnd && subscription.currentPeriodEnd
              ? `Cancels on ${dateLabel(subscription.currentPeriodEnd)}`
              : subscription?.currentPeriodEnd ? `Renews ${dateLabel(subscription.currentPeriodEnd)}` : "No renewal date on file"}
            {subscription?.status && subscription.status !== "active" ? ` · ${subscription.status.replaceAll("_", " ")}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <TrialNotice trialEndsAt={subscription?.trialEndsAt ?? null} status={subscription?.status || "trialing"} hasSubscription={!!subscription?.stripeSubscriptionId} now={now} />
          <ul className="space-y-1.5 text-sm text-stone-600">
            {plan.features.map((feature) => <li key={feature} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{feature}</li>)}
          </ul>
          {owner
            ? <UpgradePlanButton workspaceId={workspaceId} plans={upgrades.map((candidate) => ({ code: candidate.code, name: candidate.name, price: candidate.price }))} hasBillingProfile={!!subscription?.stripeCustomerId} />
            : <p className="text-sm text-muted-foreground">Only the workspace owner can change the plan.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plan usage</CardTitle>
          <CardDescription>{dateLabel(periodStart)} — {dateLabel(periodEnd)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Without this the meters would read "N used" with no ceiling and look like a bug or
            * like the plan itself is unlimited. The counters keep ticking, so an admin account's
            * real consumption is still visible here. */}
          {usage.exempt ? <p className="text-sm text-muted-foreground">Admin account — unlimited. Usage is still counted below.</p> : null}
          <Meter label="Documents" used={usage.documentsUsed} limit={usage.documentsLimit} />
          <Meter label="AI extractions" used={usage.aiUsed} limit={usage.aiLimit} />
          <p className="text-xs text-muted-foreground">Last updated {new Date().toLocaleString()}</p>
        </CardContent>
      </Card>
    </div>
  </main>
}

export const dynamic = "force-dynamic"
