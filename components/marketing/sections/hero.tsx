import { DictationDemo } from "@/components/marketing/sections/dictation-demo"
import { ExtractionDemo } from "@/components/marketing/sections/extraction-demo"
import { ArrowRight } from "lucide-react"
import Link from "next/link"

export function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-16 lg:grid-cols-[0.92fr_1.08fr] lg:py-24">
      <div>
        <h1 className="font-display text-[2.75rem] font-bold leading-[1.02] tracking-[-0.04em] text-stone-950 sm:text-6xl">
          Turn what&apos;s on paper<br className="hidden sm:inline" /> — or what you say — into data you can trust.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-stone-600">
          DocuBite reads the PDFs your work runs on — invoices, receipts, bank statements — plus the scans, photos and handwriting mixed in, into clean, structured fields. And when there&apos;s no document to begin with, talk instead: dictate freely and it&apos;s routed to the right report and filed the same way. Every value, typed or spoken, lands in a live sheet pinned to the exact spot it came from.
        </p>

        <Link href="/demo" className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-6 text-base font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800">
          Book a 20-minute demo<ArrowRight className="h-4 w-4" />
        </Link>
        <p className="mt-3 text-sm text-stone-500">No credit card required · see it on your own documents</p>
      </div>

      <div className="flex flex-col gap-5 pb-8 sm:pb-0">
        <ExtractionDemo />
        <DictationDemo />
      </div>
    </section>
  )
}
