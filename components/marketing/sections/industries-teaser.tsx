import { Reveal } from "@/components/marketing/reveal"
import { INDUSTRIES } from "@/lib/solutions"
import { ArrowRight } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"

const TINTS = ["bg-white", "bg-emerald-50", "bg-amber-50"]

/** The homepage's teaser for the industries detailed on /solutions#industries — finance,
 * healthcare, logistics. Distinct from SolutionsTeaser above it: that one is "pick the document",
 * this is "pick the team drowning in it". Cards link straight to the anchor rather than a
 * dedicated page — industries don't have their own routes, only the shared before/after content. */
export function IndustriesTeaser() {
  return (
    <section className="bg-cream-50">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <Reveal>
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Industries</p>
          <h2 className="mt-3 max-w-2xl font-display text-4xl font-bold tracking-[-0.035em] text-stone-950 sm:text-5xl">
            If it&apos;s a document your team keys in by hand, <span className="text-emerald-600">it&apos;s a template in DocuBite.</span>
          </h2>
        </Reveal>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {INDUSTRIES.map((industry, index) => (
            <Reveal key={industry.name} delay={0.08 * index}>
              <Link
                href={"/solutions#industries" as Route}
                className={`group flex h-full flex-col rounded-[2rem] rounded-tr-md border border-stone-200 p-6 transition-shadow hover:shadow-[0_24px_60px_-40px_rgba(41,37,36,.5)] ${TINTS[index % TINTS.length]}`}
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl rounded-tr-sm bg-white text-emerald-700"><industry.icon className="h-5 w-5" /></span>
                <span className="mt-5 font-display text-xl font-bold tracking-[-0.02em] text-stone-950">{industry.name}</span>
                <span className="mt-2 flex-1 text-[0.95rem] leading-6 text-stone-600">{industry.tagline}</span>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-emerald-800">
                  See the before/after<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
