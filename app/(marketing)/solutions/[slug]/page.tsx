import { EmailCapture } from "@/components/marketing/email-capture"
import { CtaBand } from "@/components/marketing/sections/cta-band"
import { Workflow } from "@/components/marketing/sections/workflow"
import { TRIAL_DAYS } from "@/lib/plans"
import { getSolution, SOLUTIONS } from "@/lib/solutions"
import { ArrowRight } from "lucide-react"
import type { Metadata, Route } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

export function generateStaticParams() {
  return SOLUTIONS.map((solution) => ({ slug: solution.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const solution = getSolution((await params).slug)
  if (!solution) return { title: "Not found" }
  return { title: solution.title, description: solution.description }
}

/** One template for all six solutions; the copy lives in lib/solutions.ts so the mega-menu, the
 * footer and this page can never disagree about which solutions exist. */
export default async function SolutionPage({ params }: { params: Promise<{ slug: string }> }) {
  const solution = getSolution((await params).slug)
  if (!solution) notFound()

  const siblings = SOLUTIONS.filter((other) => other.slug !== solution.slug)

  return <>
    <section className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
      <p className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800">
        <solution.icon className="h-4 w-4" />{solution.name}
      </p>
      <h1 className="mt-5 max-w-3xl font-display text-[2.4rem] font-bold leading-[1.05] tracking-[-0.04em] text-stone-950 sm:text-5xl">{solution.title}</h1>
      <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-600">{solution.description}</p>

      <EmailCapture size="lg" className="mt-8 max-w-lg" />
      <p className="mt-3 text-sm text-stone-500">No credit card required · {TRIAL_DAYS}-day free trial</p>

      <div className="mt-12 rounded-[2rem] rounded-tr-md border border-stone-200 bg-stone-50 p-6 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-emerald-700">Fields captured out of the box</p>
        <ul className="mt-4 flex flex-wrap gap-2">
          {solution.fields.map((field) => (
            <li key={field} className="rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-sm font-medium text-stone-700">{field}</li>
          ))}
        </ul>
        <p className="mt-5 text-sm text-stone-500">Need something else? Define your own fields, types and extraction instructions in a custom template.</p>
      </div>
    </section>

    <section className="border-y border-stone-200 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <h2 className="max-w-2xl font-display text-3xl font-bold tracking-[-0.03em] text-stone-950 sm:text-4xl">Why this document is hard, and what DocuBite does about it</h2>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {solution.points.map((point, index) => (
            <article key={point.title} className="rounded-[2rem] rounded-tr-md border border-stone-200 p-6">
              <span className="font-display text-sm font-bold text-stone-300">0{index + 1}</span>
              <h3 className="mt-4 font-display text-xl font-bold tracking-[-0.02em]">{point.title}</h3>
              <p className="mt-2 leading-7 text-stone-600">{point.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>

    <Workflow />

    <section className="border-t border-stone-200 bg-stone-50">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-stone-500">Other solutions</p>
        <div className="mt-5 flex flex-wrap gap-3">
          {siblings.map((other) => (
            <Link key={other.slug} href={`/solutions/${other.slug}` as Route} className="group inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:border-emerald-300 hover:text-emerald-800">
              <other.icon className="h-4 w-4 text-emerald-700" />{other.name}
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </div>
    </section>

    <CtaBand />
  </>
}
