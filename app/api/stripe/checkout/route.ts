import config from "@/lib/config"
import { prisma } from "@/lib/db"
import { getApiUser } from "@/lib/auth"
import { getWorkspacePlan } from "@/lib/plans"
import { requireWorkspaceRole } from "@/models/workspaces"
import { stripeClient } from "@/lib/stripe"
import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { workspaceId?: string; code?: string } | null
  if (!body?.workspaceId || !body.code) return NextResponse.json({ error: "Missing workspace or plan" }, { status: 400 })
  if (!stripeClient) return NextResponse.json({ error: "Stripe is not enabled" }, { status: 503 })
  const plan = getWorkspacePlan(body.code); if (plan.code !== body.code || !plan.priceId) return NextResponse.json({ error: "Invalid plan" }, { status: 400 })
  const user = await getApiUser(); if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 })
  const membership = await requireWorkspaceRole(body.workspaceId, user.id, ["owner"])
  const subscription = await prisma.workspaceSubscription.upsert({ where: { workspaceId: body.workspaceId }, create: { workspaceId: body.workspaceId }, update: {} })
  // Checkout only ever *creates* a subscription. Without this a workspace that already pays could
  // open Upgrade again and end up with two live Stripe subscriptions billing the same card, and
  // nothing downstream would notice: the webhook overwrites stripeSubscriptionId with whichever
  // arrived last, orphaning the first from the app while Stripe keeps charging for it. Plan
  // changes belong in the portal, which swaps the price on the existing subscription.
  if (subscription.stripeSubscriptionId && ["active", "past_due", "trialing"].includes(subscription.status)) {
    return NextResponse.json({ error: "This workspace already has a subscription. Use the billing portal to change plans." }, { status: 409 })
  }
  let customerId = subscription.stripeCustomerId
  if (!customerId) { const customer = await stripeClient.customers.create({ email: user.email, name: membership.workspace.name, metadata: { workspaceId: body.workspaceId } }); customerId = customer.id; await prisma.workspaceSubscription.update({ where: { id: subscription.id }, data: { stripeCustomerId: customerId } }) }
  // Whatever is left of the free trial carries over, so adding a card early is never punished by
  // losing the days already paid for in attention. Stripe accepts 1–730 whole days, so a trial
  // that has run out is simply omitted rather than sent as 0.
  const trialDaysLeft = subscription.trialEndsAt ? Math.ceil((subscription.trialEndsAt.getTime() - Date.now()) / 86_400_000) : 0
  const trial = trialDaysLeft > 0 && !subscription.stripeSubscriptionId ? { trial_period_days: Math.min(trialDaysLeft, 730) } : {}
  const session = await stripeClient.checkout.sessions.create({ customer: customerId, mode: "subscription", line_items: [{ price: plan.priceId, quantity: 1 }], billing_address_collection: "auto", automatic_tax: { enabled: true }, allow_promotion_codes: true, metadata: { workspaceId: body.workspaceId, planCode: plan.code }, subscription_data: { ...trial, metadata: { workspaceId: body.workspaceId, planCode: plan.code } }, success_url: `${config.app.baseURL}/workspaces/${body.workspaceId}/settings/billing?checkout=success`, cancel_url: `${config.app.baseURL}/workspaces/${body.workspaceId}/settings/billing?checkout=canceled` })
  return NextResponse.json({ url: session.url })
}
