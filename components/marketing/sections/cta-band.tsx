import { ArrowRight } from "lucide-react"
import Link from "next/link"

export function CtaBand() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="rounded-[2.5rem] rounded-tr-lg bg-emerald-950 px-6 py-14 text-center text-white sm:px-14">
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-bold tracking-[-0.03em] sm:text-[2.6rem] sm:leading-[1.08]">
            Your inbox is full of documents. Let something else read them.
          </h2>
          <p className="mx-auto mt-4 max-w-xl leading-7 text-emerald-100/75">
            Book a demo and put your worst-looking folder — or a free-form recording — through it first.
          </p>
          <Link
            href="/demo"
            className="mx-auto mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-white px-6 text-base font-semibold text-emerald-900 shadow-sm transition-colors hover:bg-emerald-50"
          >
            Book a demo<ArrowRight className="h-4 w-4" />
          </Link>
          <p className="mt-4 text-sm text-emerald-100/60">No credit card required</p>
        </div>
      </div>
    </section>
  )
}
