import { prisma } from "@/lib/db"
import { getWorkspacePlan, WORKSPACE_PLANS } from "@/lib/plans"
import Stripe from "stripe"

/** The Stripe webhook's body, lifted out of app/api/stripe/webhook/route.ts so it has two
 * callers: the route itself, and the admin console's "retry" button.
 *
 * A mechanical move, not a rewrite — the claim logic, the branch set, the deliberate absence of
 * an invoice.payment_failed branch, and the "answer 500 so Stripe retries" contract are all
 * unchanged, and their reasoning is preserved in the comments below. The route keeps signature
 * verification, which is the one part that only makes sense for a real HTTP request.
 *
 * The retry button needs this because StripeWebhookEvent does not store the payload (the route
 * has always said as much), so replaying means re-fetching the event from Stripe and running it
 * through the same code the webhook would have. */

export const safeWebhookErrorCode = (error: unknown) =>
  (error instanceof Error ? error.message : "webhook_failed").replace(/[^a-z0-9_]/gi, "_").slice(0, 96).toLowerCase()

const WEBHOOK_LEASE_MS = 5 * 60 * 1000

/** Falls back to the plan the row is already on, never to "starter": an Enterprise workspace on a
 * price ID this deployment does not have configured would otherwise be silently downgraded to the
 * entry plan's limits by any routine subscription event. */
function subscriptionPlan(subscription: Stripe.Subscription, current: string) {
  const priceId = subscription.items.data[0]?.price.id
  return Object.values(WORKSPACE_PLANS).find((plan) => plan.priceId === priceId)?.code || current
}

export async function claimWebhookEvent(event: Pick<Stripe.Event, "id" | "type">) {
  let eventRow = await prisma.stripeWebhookEvent.findUnique({ where: { stripeEventId: event.id } })
  if (!eventRow) {
    try { eventRow = await prisma.stripeWebhookEvent.create({ data: { stripeEventId: event.id, type: event.type } }) }
    catch { eventRow = await prisma.stripeWebhookEvent.findUniqueOrThrow({ where: { stripeEventId: event.id } }) }
  }
  if (eventRow.status === "processed") return { eventRow, claimed: false }
  const now = new Date()
  const claimed = await prisma.stripeWebhookEvent.updateMany({
    where: { id: eventRow.id, OR: [{ status: { in: ["pending", "failed"] } }, { status: "processing", leaseUntil: { lte: now } }] },
    data: { status: "processing", attempts: { increment: 1 }, errorCode: null, processingStartedAt: now, leaseUntil: new Date(now.getTime() + WEBHOOK_LEASE_MS) },
  })
  return { eventRow, claimed: Boolean(claimed.count) }
}

export type StripeEventOutcome = { ok: true; ignored: boolean } | { ok: false; errorCode: string }

/** Applies one claimed event to the local subscription row and closes out its StripeWebhookEvent.
 *
 * On failure the row goes back to "failed" and the error is reported rather than thrown, so the
 * route can answer 500 (which is what re-enters Stripe's ~3-day retry schedule) and the admin
 * console can show a message. There is deliberately no local sweeper — a row Stripe has given up
 * on needs a human looking at errorCode, which is now what /admin/billing is for. */
export async function applyStripeEvent(event: Stripe.Event, eventRow: { id: string }): Promise<StripeEventOutcome> {
  try {
    let workspaceId: string | undefined; let customerId: string | undefined; let subscriptionId: string | undefined; let status: string | undefined; let planCode: string | undefined; let periodStart: Date | null = null; let periodEnd: Date | null = null
    // `false` rather than undefined: a completed checkout is a fresh subscription, so any
    // cancel-at-period-end left over from a previous one on this workspace has to be cleared.
    let cancelAtPeriodEnd = false
    // Resolved after the row is loaded — the price-ID fallback needs the plan the row is on.
    let stripeSubscription: Stripe.Subscription | null = null
    // Deliberately no invoice.payment_failed branch. On API version 2025-08-27.basil the invoice
    // object no longer carries a top-level `subscription`, so there would be nothing to key the
    // workspace off; and Stripe's dunning already emits customer.subscription.updated with
    // past_due / unpaid, which the branch below handles and consumeWorkspaceQuota acts on.
    if (event.type === "checkout.session.completed") {
      const checkout = event.data.object as Stripe.Checkout.Session
      workspaceId = checkout.metadata?.workspaceId
      customerId = typeof checkout.customer === "string" ? checkout.customer : checkout.customer?.id
      subscriptionId = typeof checkout.subscription === "string" ? checkout.subscription : checkout.subscription?.id
      planCode = checkout.metadata?.planCode
      // "active" even when the session opened a trial. Correct within the second: Stripe sends
      // customer.subscription.created alongside this, and that branch writes the real status.
      // Fetching the subscription from the API here to be precise would trade a self-contained
      // handler for a network call inside a leased transaction — not worth it.
      status = "active"
    } else if (event.type.startsWith("customer.subscription.")) {
      const sub = event.data.object as Stripe.Subscription
      stripeSubscription = sub
      workspaceId = sub.metadata?.workspaceId
      customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id
      subscriptionId = sub.id
      status = sub.status
      cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end)
      const item = sub.items.data[0] as Stripe.SubscriptionItem & { current_period_start?: number; current_period_end?: number }
      periodStart = item.current_period_start ? new Date(item.current_period_start * 1000) : null
      periodEnd = item.current_period_end ? new Date(item.current_period_end * 1000) : null
    } else {
      await prisma.stripeWebhookEvent.update({ where: { id: eventRow.id }, data: { status: "processed", processedAt: new Date(), leaseUntil: null } })
      return { ok: true, ignored: true }
    }

    const subscription = workspaceId
      ? await prisma.workspaceSubscription.findUnique({ where: { workspaceId } })
      : await prisma.workspaceSubscription.findFirst({ where: { OR: [{ stripeCustomerId: customerId }, { stripeSubscriptionId: subscriptionId }] } })
    if (!subscription) throw new Error("workspace_subscription_not_found")
    if (stripeSubscription) planCode = subscriptionPlan(stripeSubscription, subscription.planCode)

    await prisma.$transaction([
      prisma.workspaceSubscription.update({
        where: { id: subscription.id },
        data: {
          stripeCustomerId: customerId || subscription.stripeCustomerId,
          stripeSubscriptionId: subscriptionId || subscription.stripeSubscriptionId,
          status: status || subscription.status,
          planCode: planCode || getWorkspacePlan(subscription.planCode).code,
          cancelAtPeriodEnd,
          currentPeriodStart: periodStart || subscription.currentPeriodStart,
          currentPeriodEnd: periodEnd || subscription.currentPeriodEnd,
        },
      }),
      prisma.stripeWebhookEvent.update({ where: { id: eventRow.id }, data: { workspaceId: subscription.workspaceId, status: "processed", processedAt: new Date(), leaseUntil: null } }),
    ])
    return { ok: true, ignored: false }
  } catch (error) {
    const errorCode = safeWebhookErrorCode(error)
    await prisma.stripeWebhookEvent.update({ where: { id: eventRow.id }, data: { status: "failed", errorCode, leaseUntil: null } })
    return { ok: false, errorCode }
  }
}
