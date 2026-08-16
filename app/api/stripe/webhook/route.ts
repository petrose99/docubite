import config from "@/lib/config"
import { applyStripeEvent, claimWebhookEvent } from "@/lib/stripe-events"
import { stripeClient } from "@/lib/stripe"
import Stripe from "stripe"

/** Stripe's delivery endpoint. Everything past signature verification now lives in
 * lib/stripe-events.ts, because the admin console's retry button has to run the identical logic
 * against an event it re-fetched from the API — StripeWebhookEvent does not store the payload,
 * so a replay has to go back to Stripe for it.
 *
 * Answering 500 is the recovery mechanism: the row goes back to "failed", and Stripe's retry
 * schedule (roughly 3 days of backoff) re-enters claimWebhookEvent, which claims "failed" rows. */
export async function POST(request: Request) {
  if (!stripeClient || !config.stripe.webhookSecret) return new Response("Webhook not configured", { status: 400 })
  const signature = request.headers.get("stripe-signature"); const body = await request.text(); if (!signature) return new Response("Missing signature", { status: 400 })
  let event: Stripe.Event; try { event = stripeClient.webhooks.constructEvent(body, signature, config.stripe.webhookSecret) } catch { return new Response("Invalid signature", { status: 400 }) }

  const { eventRow, claimed } = await claimWebhookEvent(event)
  if (!claimed) return new Response(eventRow.status === "processed" ? "Already processed" : "Already processing")

  const outcome = await applyStripeEvent(event, eventRow)
  if (!outcome.ok) return new Response("Retry", { status: 500 })
  return new Response(outcome.ignored ? "Ignored" : "Processed")
}
