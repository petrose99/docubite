import { BiteMark } from "@/components/marketing/logo"
import { ExtractionDemo } from "@/components/marketing/sections/extraction-demo"
import { ArrowRight, FileText, PenLine } from "lucide-react"
import Link from "next/link"

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-cream-50">
      <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-[34rem] w-[34rem] opacity-[0.05] sm:-left-16 sm:-top-32">
        <BiteMark className="h-full w-full" />
      </div>
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 py-16 lg:grid-cols-[0.92fr_1.08fr] lg:py-24">
        <div>
          <h1 className="font-display text-5xl font-bold leading-[0.98] tracking-[-0.045em] text-stone-950 sm:text-7xl">
            Turn what&apos;s on paper into <span className="text-emerald-600">data you can trust.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-stone-600">
            DocuBite reads the invoices, receipts and bank statements your work runs on — scans, photos and handwriting included — into a live sheet where every value traces back to the exact spot it came from.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link href="/demo" className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-emerald-950 px-7 text-base font-semibold text-white shadow-sm transition-colors hover:bg-emerald-900">
              Book a 20-minute demo<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a href="#how" className="text-sm font-semibold text-stone-700 underline decoration-stone-300 underline-offset-4 transition-colors hover:text-stone-950">
              See how it reads ↓
            </a>
          </div>
          <p className="mt-3 text-sm text-stone-500">No credit card required · see it on your own documents</p>
        </div>

        <div className="relative pb-8 sm:pb-0">
          <div className="rotate-[1.5deg]">
            <ExtractionDemo />
          </div>

          <div className="docubite-float pointer-events-none absolute -left-6 top-6 hidden items-center gap-1.5 rounded-xl rounded-tr-sm bg-white px-3 py-1.5 text-[0.7rem] font-semibold text-stone-700 shadow-[0_16px_36px_-20px_rgba(41,37,36,.5)] sm:flex">
            <PenLine className="h-3.5 w-3.5 text-amber-600" />Handwriting · read ✓
          </div>
          <div className="docubite-float pointer-events-none absolute -right-4 bottom-10 hidden items-center gap-1.5 rounded-xl rounded-tr-sm bg-white px-3 py-1.5 text-[0.7rem] font-semibold text-stone-700 shadow-[0_16px_36px_-20px_rgba(41,37,36,.5)] sm:flex" style={{ animationDelay: "1.4s" }}>
            <FileText className="h-3.5 w-3.5 text-emerald-700" />Every cell → its source
          </div>
          <span className="absolute -bottom-2 left-1/2 hidden h-2.5 w-2.5 rounded-full bg-amber-400 sm:block" aria-hidden />
        </div>
      </div>
    </section>
  )
}
