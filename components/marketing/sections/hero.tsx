import { EmailCapture } from "@/components/marketing/email-capture"
import { ExtractionDemo } from "@/components/marketing/sections/extraction-demo"
import { TRIAL_DAYS } from "@/lib/plans"
import { ArrowRight } from "lucide-react"
import Link from "next/link"

export function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-16 lg:grid-cols-[0.92fr_1.08fr] lg:py-24">
      <div>
        <h1 className="font-display text-[2.75rem] font-bold leading-[1.02] tracking-[-0.04em] text-stone-950 sm:text-6xl">
          Turn your PDFs<br className="hidden sm:inline" /> into a spreadsheet you can trust.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-8 text-stone-600">
          DocuBite reads the PDFs your work runs on — invoices, receipts, bank statements — plus the scans, photos and handwriting mixed in, into clean, structured fields. Drop in one file or a folder of a hundred: every value lands in a live sheet, pinned to the exact spot it came from, and the pile comes back checked for gaps and duplicates.
        </p>

        <EmailCapture size="lg" className="mt-8 max-w-lg" />
        <p className="mt-3 text-sm text-stone-500">No credit card required · {TRIAL_DAYS}-day free trial</p>

        <Link href="/demo" className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-800 underline-offset-4 hover:underline">
          Or book a 20-minute demo<ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <ExtractionDemo />
    </section>
  )
}
