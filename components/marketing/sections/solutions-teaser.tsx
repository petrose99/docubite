import { SOLUTION_GROUPS, solutionsByGroup } from "@/lib/solutions"
import { ArrowRight } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"

export function SolutionsTeaser() {
  return (
    <section id="industries" className="bg-white">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Solutions</p>
        <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-[-0.03em] text-stone-950 sm:text-4xl">
          Built for the documents your team retypes today.
        </h2>

        <div className="mt-12 space-y-10">
          {SOLUTION_GROUPS.map((group) => (
            <div key={group.id}>
              <p className="text-xs font-semibold uppercase tracking-[.16em] text-stone-500">{group.label}</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {solutionsByGroup(group.id).map((solution) => (
                  <Link
                    key={solution.slug}
                    href={`/solutions/${solution.slug}` as Route}
                    className="group flex flex-col rounded-[1.75rem] rounded-tr-md border border-stone-200 bg-white p-5 transition-shadow hover:shadow-[0_24px_60px_-40px_rgba(41,37,36,.5)]"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl rounded-tr-sm bg-emerald-50 text-emerald-700"><solution.icon className="h-5 w-5" /></span>
                    <span className="mt-4 font-display text-lg font-bold tracking-[-0.02em] text-stone-900">{solution.name}</span>
                    <span className="mt-1.5 flex-1 text-sm leading-6 text-stone-600">{solution.tagline}</span>
                    <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-emerald-800">
                      See how<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
