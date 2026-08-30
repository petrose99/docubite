import { DocTypeGrid, type DocCard } from "@/components/marketing/sections/doc-type-grid"
import { ArrowRight } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Solutions",
  description: "Pick the document, or the mess it arrived in, then see the before/after.",
}

const byType: DocCard[] = [
  { name: "Invoices", text: "Supplier, number, dates, line items, tax", icon: "FileText" },
  { name: "Receipts", text: "Merchant, date, total, tax, line items", icon: "Receipt" },
  { name: "Expense receipts", text: "Merchant, total, tax code, category, payment method", icon: "Receipt" },
  { name: "Bank statements", text: "Multi-page transaction tables into rows", icon: "Landmark" },
  { name: "Purchase orders", text: "PO number, supplier, line items, totals", icon: "Package" },
  { name: "Remittance advice", text: "Payer, payee, invoice allocations", icon: "Landmark" },
  { name: "Contracts & forms", text: "Parties, dates, terms, signatures", icon: "FileSignature" },
]

const byQuality: DocCard[] = [
  { name: "Handwritten", text: "Delivery notes, forms, annotated invoices", icon: "PenLine" },
  { name: "Scanned PDFs", text: "Image-only PDFs, faxes, photocopies", icon: "ScanLine" },
  { name: "Phone photos", text: "Angled, low-light snaps, curled thermal paper", icon: "Camera" },
  { name: "Long bundles", text: "40-page scans batched and stitched, not truncated", icon: "Layers" },
]

export default function SolutionsPage() {
  return <>
    <section className="bg-cream-50">
      <div className="mx-auto max-w-6xl px-5 pt-16 pb-2 lg:pt-20">
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Solutions</p>
        <h1 className="mt-3.5 max-w-3xl font-display text-5xl font-bold leading-[0.98] tracking-[-0.045em] text-stone-950 sm:text-6xl">
          Point DocuBite at whatever <span className="text-emerald-600">your team keys in by hand.</span>
        </h1>
        <p className="mt-4 max-w-xl text-lg leading-8 text-stone-600">
          Pick the document, or the mess it arrived in — then see the before/after for your industry. The parser is general and the templates are yours.
        </p>
      </div>
    </section>

    <section id="by-type" className="mx-auto max-w-6xl px-5 pt-11">
      <p className="text-xs font-semibold uppercase tracking-[.16em] text-stone-500">By document type</p>
      <p className="mt-1.5 text-sm text-stone-500">A sample. If yours isn&apos;t here, it&apos;s a custom template away.</p>
      <DocTypeGrid cards={byType} showCustomCard collapseAfter={8} />

      <p id="by-quality" className="mt-8 text-xs font-semibold uppercase tracking-[.16em] text-stone-500">By document quality</p>
      <DocTypeGrid cards={byQuality} />

      <p className="mt-8 max-w-xl text-sm leading-7 text-stone-500">
        Not on this list? Bring any recurring PDF, scan or photo — define its fields once with a custom template and DocuBite reads the rest the same way.
      </p>
    </section>

    <section id="cta" className="bg-white">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="relative overflow-hidden rounded-[2.5rem] rounded-tr-lg bg-emerald-950 px-6 py-14 text-center text-white sm:px-14">
          <div className="pointer-events-none absolute -right-8 -top-10 h-52 w-52 rounded-full bg-[radial-gradient(circle,rgba(52,211,153,.18),transparent_70%)]" />
          <h2 className="relative mx-auto max-w-xl font-display text-3xl font-bold tracking-[-0.035em] sm:text-[2.4rem] sm:leading-[1.08]">
            Put your worst-looking document through it first.
          </h2>
          <p className="relative mx-auto mt-4 max-w-lg leading-7 text-emerald-100/75">
            Book a demo and bring a sample — we&apos;ll build the template with you, live.
          </p>
          <div className="relative mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link href="/demo" className="group inline-flex h-12 items-center justify-center gap-1.5 rounded-full bg-white px-7 text-[15px] font-semibold text-emerald-950">Book a demo<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></Link>
          </div>
        </div>
      </div>
    </section>
  </>
}
