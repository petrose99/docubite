import { Reveal } from "@/components/marketing/reveal"
import { SOLUTION_GROUPS, solutionsByGroup } from "@/lib/solutions"
import { ArrowRight } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"

const TINTS = ["bg-emerald-50 text-emerald-800", "bg-amber-50 text-amber-800", "bg-cream-100 text-stone-800"]

export function SolutionsTeaser() {
  return (
    <section id="industries" className="bg-white">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <Reveal>
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Solutions</p>
          <h2 className="mt-3 max-w-2xl font-display text-4xl font-bold tracking-[-0.035em] text-stone-950 sm:text-5xl">
            Pick the document. Or pick the <span className="text-emerald-600">mess it arrived in.</span>
          </h2>
        </Reveal>

        <div className="mt-12 space-y-10">
          {SOLUTION_GROUPS.map((group, groupIndex) => (
            <div key={group.id}>
              <p className="text-xs font-semibold uppercase tracking-[.16em] text-stone-500">{group.label}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                {solutionsByGroup(group.id).map((solution, index) => (
                  <Reveal key={solution.slug} delay={0.05 * index} as="span" className="inline-block">
                    <Link
                      href={`/solutions/${solution.slug}` as Route}
                      className={`group inline-flex items-center gap-3 rounded-full rounded-tr-md py-2.5 pl-3 pr-5 transition-shadow hover:shadow-[0_16px_36px_-20px_rgba(41,37,36,.4)] ${TINTS[(groupIndex + index) % TINTS.length]}`}
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/80"><solution.icon className="h-4 w-4" /></span>
                      <span className="font-display text-base font-bold tracking-[-0.01em]">{solution.name}</span>
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </Reveal>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
