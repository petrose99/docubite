import { TRIAL_DAYS, WORKSPACE_PLANS } from "@/lib/plans"
import { Check } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"

/** Reads WORKSPACE_PLANS rather than restating the plans in marketing copy: the Billing & Usage
 * card in the app renders from the same object, so a price or limit can only ever be changed in
 * one place. `price: -1` is the "talk to us" sentinel.
 *
 * Shared by the homepage's pricing band and the standalone /pricing page — the repositioning
 * puts pricing on the homepage itself rather than leaving it a click away, but the numbers still
 * live in one component so the two never drift apart. */
const plans = Object.values(WORKSPACE_PLANS)

export function Pricing({ eyebrow = true }: { eyebrow?: boolean } = {}) {
  return (
    <section id="pricing" className="border-t border-stone-200 bg-stone-50">
      <div className="mx-auto max-w-6xl px-5 py-20">
        {eyebrow && <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Pricing</p>}
        <h2 className="mt-3 max-w-xl font-display text-3xl font-bold leading-[1.06] tracking-[-0.035em] text-stone-950 sm:text-4xl">
          One price per workspace. {TRIAL_DAYS} days to make up your mind.
        </h2>
        <p className="mt-4 max-w-lg text-lg leading-7 text-stone-600">
          Every plan starts as a free trial with no credit card. Add a payment method whenever you&apos;re ready.
        </p>

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {plans.map((plan) => {
            const custom = plan.price < 0
            const featured = plan.code === "growth"
            return (
              <article
                key={plan.code}
                className={`flex flex-col rounded-[2rem] rounded-tr-md border p-7 ${featured ? "border-emerald-700 bg-emerald-950 text-white shadow-[0_32px_80px_-48px_rgba(6,78,59,.8)]" : "border-stone-200 bg-white"}`}
              >
                <div className="flex items-center justify-between">
                  <h3 className={`font-display text-xl font-bold tracking-[-0.02em] ${featured ? "text-white" : "text-stone-900"}`}>{plan.name}</h3>
                  {featured && <span className="rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-300">Most popular</span>}
                </div>

                <p className="mt-5 flex items-baseline gap-1.5">
                  <span className={`font-display text-4xl font-bold tracking-[-0.03em] ${featured ? "text-white" : "text-stone-950"}`}>{custom ? "Talk to us" : `$${plan.price}`}</span>
                  {!custom && <span className={featured ? "text-emerald-100/70" : "text-stone-500"}>/month</span>}
                </p>

                <ul className={`mt-7 flex-1 space-y-2.5 text-sm ${featured ? "text-emerald-100/85" : "text-stone-600"}`}>
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5">
                      <Check className={`mt-0.5 h-4 w-4 shrink-0 ${featured ? "text-emerald-400" : "text-emerald-600"}`} />{feature}
                    </li>
                  ))}
                </ul>

                {custom ? (
                  <Link href="/demo" className={`mt-8 inline-flex h-11 items-center justify-center rounded-lg border text-sm font-semibold transition-colors ${featured ? "border-white/25 text-white hover:bg-white/10" : "border-stone-300 text-stone-900 hover:bg-stone-100"}`}>
                    Talk to us
                  </Link>
                ) : (
                  <Link
                    href={`/signup?plan=${plan.code}` as Route}
                    className={`mt-8 inline-flex h-11 items-center justify-center rounded-lg text-sm font-semibold shadow-sm transition-colors ${featured ? "bg-white text-emerald-900 hover:bg-emerald-50" : "bg-emerald-700 text-white hover:bg-emerald-800"}`}
                  >
                    Start free trial
                  </Link>
                )}
              </article>
            )
          })}
        </div>

        <p className="mt-8 text-sm text-stone-500">
          Prices in USD, billed monthly through Stripe. Owners can change or cancel a plan from Billing &amp; Usage at any time.
        </p>
      </div>
    </section>
  )
}
