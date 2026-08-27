import { TRIAL_DAYS } from "@/lib/plans"
import { ArrowRight } from "lucide-react"
import Link from "next/link"

type CtaVariant = "demo" | "selfServe"

/** Accounting is self-serve now that /pricing is real (see app/(marketing)/pricing) — this band
 * has to say that instead of "book a demo" or it contradicts the page a visitor just left. Clinical
 * (and the neutral homepage) stay demo-led: BAA coverage is set up with sales, not a signup form. */
export function CtaBand({ variant = "demo" }: { variant?: CtaVariant }) {
  const selfServe = variant === "selfServe"

  return (
    <section id="pricing" className="bg-cream-50">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="rounded-[2.5rem] rounded-tr-lg bg-emerald-950 px-6 py-14 text-center text-white sm:px-14">
          <h2 className="mx-auto max-w-2xl font-display text-4xl font-bold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
            Your inbox is full of documents. Let something else <span className="text-amber-300">read them.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl leading-7 text-emerald-100/75">
            {selfServe
              ? `Start a ${TRIAL_DAYS}-day free trial and put your worst-looking folder through it first.`
              : "Book a demo and put your worst-looking folder — or a free-form recording — through it first."}
          </p>

          <Link
            href={selfServe ? "/signup" : "/demo"}
            className="group mx-auto mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-7 text-base font-semibold text-emerald-950 shadow-sm transition-colors hover:bg-cream-100"
          >
            {selfServe ? "Start free trial" : "Book a demo"}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>

          <div className="perforation mx-auto mt-10 max-w-md text-emerald-800" aria-hidden />

          <p className="mx-auto mt-6 max-w-lg text-sm leading-6 text-emerald-100/70">
            {selfServe
              ? <>See plans and what&apos;s included on <Link href="/pricing" className="font-semibold text-white underline underline-offset-2">the pricing page</Link> — every workspace starts on a {TRIAL_DAYS}-day free trial, no credit card required.</>
              : `Workspace-based pricing, sized to how your team uses it — every workspace starts on a ${TRIAL_DAYS}-day free trial, no credit card required. We'll walk through usage, seats and the right plan on the call.`}
          </p>
        </div>
      </div>
    </section>
  )
}
