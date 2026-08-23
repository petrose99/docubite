import { ArrowRight } from "lucide-react"
import Link from "next/link"

/** No dollar figures on the marketing site: WORKSPACE_PLANS (lib/plans.ts) still drives real
 * billing and the in-app Billing & Usage card, but the public pitch is demo-only — one panel,
 * one CTA, no per-tier comparison. */
export function DemoCta({ eyebrow = true }: { eyebrow?: boolean } = {}) {
  return (
    <section id="pricing" className="border-t border-stone-200 bg-stone-50">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="rounded-[2.5rem] rounded-tr-lg border border-stone-200 bg-white px-6 py-14 text-center sm:px-14">
          {eyebrow && <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Pricing</p>}
          <h2 className="mx-auto mt-3 max-w-xl font-display text-3xl font-bold leading-[1.08] tracking-[-0.035em] text-stone-950 sm:text-4xl">
            Workspace-based pricing, sized to how your team uses it.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-lg leading-7 text-stone-600">
            Every workspace starts on a free trial. Book a demo and we&apos;ll walk through usage, seats and the right plan for your team — no price list, no guessing.
          </p>

          <Link
            href="/demo"
            className="mx-auto mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-6 text-base font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800"
          >
            Book a demo<ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  )
}
