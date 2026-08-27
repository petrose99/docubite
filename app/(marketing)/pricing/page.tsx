import { TRIAL_DAYS, WORKSPACE_PLANS } from "@/lib/plans"
import { Check, ArrowRight } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Pricing",
  description: `Start a ${TRIAL_DAYS}-day free trial, no credit card required. Plans for a solo bookkeeper up to a firm with a team.`,
}

/** Self-serve for accounting: every plan here starts an actual Stripe subscription through the
 * existing checkout route (app/api/stripe/checkout/route.ts) once the visitor has a workspace to
 * attach it to — signup first, then Billing & Usage, the same two steps as any other upgrade.
 * Enterprise has no priceId (see lib/plans.ts) and is sales-led, so it points at /demo instead. */
export default function PricingPage() {
  const plans = Object.values(WORKSPACE_PLANS)

  return <>
    <section className="bg-cream-50">
      <div className="mx-auto max-w-4xl px-5 pt-16 pb-12 text-center lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Pricing</p>
        <h1 className="mt-3.5 font-display text-5xl font-bold leading-[0.98] tracking-[-0.045em] text-stone-950 sm:text-6xl">
          Start free. <span className="text-emerald-600">Pick a plan once you know it works.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg leading-8 text-stone-600">
          Every plan starts with a {TRIAL_DAYS}-day free trial, no credit card required. Add one from Billing whenever you&apos;re ready to carry on.
        </p>
      </div>
    </section>

    <section className="mx-auto max-w-6xl px-5 pb-20">
      <div className="grid gap-6 lg:grid-cols-3">
        {plans.map((plan) => {
          const talkToUs = plan.price < 0
          return <div key={plan.code} className={`flex flex-col rounded-[1.75rem] border p-7 ${plan.code === "growth" ? "border-emerald-300 bg-emerald-50/40 shadow-[0_30px_70px_-45px_rgba(6,95,70,.4)]" : "border-stone-200 bg-white"}`}>
            <h2 className="font-display text-xl font-bold tracking-[-0.02em] text-stone-950">{plan.name}</h2>
            <p className="mt-3 flex items-baseline gap-1">
              {talkToUs
                ? <span className="text-3xl font-bold text-stone-950">Talk to us</span>
                : <>
                    <span className="text-4xl font-bold tracking-[-0.03em] text-stone-950">${plan.price}</span>
                    <span className="text-sm font-medium text-stone-500">/ month</span>
                  </>}
            </p>

            <ul className="mt-6 flex flex-1 flex-col gap-2.5">
              {plan.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm leading-6 text-stone-600">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{feature}
                </li>
              ))}
            </ul>

            <Link
              href={talkToUs ? "/demo" : `/signup?plan=${plan.code}`}
              className={`group mt-7 inline-flex h-11 items-center justify-center gap-1.5 rounded-full px-5 text-sm font-semibold transition-colors ${plan.code === "growth" ? "bg-emerald-950 text-white hover:bg-emerald-900" : "border border-stone-300 text-stone-800 hover:bg-stone-50"}`}
            >
              {talkToUs ? "Talk to us" : `Start free trial`}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        })}
      </div>

      <p className="mt-8 text-center text-sm text-stone-500">
        Handling protected health information? <Link href="/clinical" className="font-medium text-emerald-700 hover:underline">See clinical pricing</Link> — BAA-covered plans are set up with our team, not self-serve.
      </p>
    </section>
  </>
}
