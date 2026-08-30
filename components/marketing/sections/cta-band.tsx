import { ArrowRight } from "lucide-react"
import Link from "next/link"

/** A single self-serve CTA — no trial-length copy, no pricing page to point at. */
export function CtaBand() {
  return (
    <section id="get-started" className="bg-cream-50">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="rounded-[2.5rem] rounded-tr-lg bg-emerald-950 px-6 py-14 text-center text-white sm:px-14">
          <h2 className="mx-auto max-w-2xl font-display text-4xl font-bold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
            Your inbox is full of documents. Let something else <span className="text-amber-300">read them.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl leading-7 text-emerald-100/75">
            Put your worst-looking folder through it first.
          </p>

          <Link
            href="/signup"
            className="group mx-auto mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-7 text-base font-semibold text-emerald-950 shadow-sm transition-colors hover:bg-cream-100"
          >
            Get started<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>

          <div className="perforation mx-auto mt-10 max-w-md text-emerald-800" aria-hidden />

          <p className="mx-auto mt-6 max-w-lg text-sm leading-6 text-emerald-100/70">
            No credit card required.
          </p>
        </div>
      </div>
    </section>
  )
}
