import { TRIAL_DAYS } from "@/lib/plans"
import { ArrowRight } from "lucide-react"
import Link from "next/link"

/** No dollar figures on the marketing site: WORKSPACE_PLANS (lib/plans.ts) still drives real
 * billing and the in-app Billing & Usage card, but the public pitch is demo-only. Absorbs what
 * used to be sections/pricing.tsx's DemoCta so the page ends on one panel, not two back to back. */
export function CtaBand() {
  return (
    <section id="pricing" className="bg-cream-50">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="rounded-[2.5rem] rounded-tr-lg bg-emerald-950 px-6 py-14 text-center text-white sm:px-14">
          <h2 className="mx-auto max-w-2xl font-display text-4xl font-bold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
            Your inbox is full of documents. Let something else <span className="text-amber-300">read them.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl leading-7 text-emerald-100/75">
            Book a demo and put your worst-looking folder — or a free-form recording — through it first.
          </p>

          <Link
            href="/demo"
            className="group mx-auto mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-7 text-base font-semibold text-emerald-950 shadow-sm transition-colors hover:bg-cream-100"
          >
            Book a demo<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>

          <div className="perforation mx-auto mt-10 max-w-md text-emerald-800" aria-hidden />

          <p className="mx-auto mt-6 max-w-lg text-sm leading-6 text-emerald-100/70">
            Workspace-based pricing, sized to how your team uses it — every workspace starts on a {TRIAL_DAYS}-day free trial, no credit card required. No price list, no guessing: we&apos;ll walk through usage, seats and the right plan on the call.
          </p>
        </div>
      </div>
    </section>
  )
}
