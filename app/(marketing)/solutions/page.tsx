import { DocTypeGrid, type DocCard } from "@/components/marketing/sections/doc-type-grid"
import { INDUSTRIES } from "@/lib/solutions"
import { ArrowRight, Check, Clock } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Solutions",
  description: "Pick the document, or the mess it arrived in, then see the before/after for your industry.",
}

const byType: DocCard[] = [
  { name: "Invoices", text: "Supplier, number, dates, line items, tax", icon: "FileText" },
  { name: "Receipts", text: "Merchant, date, total, tax, line items", icon: "Receipt" },
  { name: "Expense receipts", text: "Merchant, total, tax code, category, payment method", icon: "Receipt" },
  { name: "Bank statements", text: "Multi-page transaction tables into rows", icon: "Landmark" },
  { name: "Purchase orders", text: "PO number, supplier, line items, totals", icon: "Package" },
  { name: "Remittance advice", text: "Payer, payee, invoice allocations", icon: "Landmark" },
  { name: "Referral letters", text: "Patient, referrer, reason, dates", icon: "Mail" },
  { name: "Lab result sheets", text: "Test, value, reference range, date", icon: "FlaskConical" },
  { name: "Insurance claims", text: "Claimant, policy no., amounts, codes", icon: "ShieldCheck" },
  { name: "Bills of lading", text: "Shipper, consignee, container, weights", icon: "Truck" },
  { name: "Delivery notes / PODs", text: "Order ref, items, quantities, signature", icon: "FileCheck" },
  { name: "Packing lists", text: "SKU, description, quantity, cartons", icon: "ClipboardList" },
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
      <p className="mt-1.5 text-sm text-stone-500">A sample — from finance, healthcare and logistics. If yours isn&apos;t here, it&apos;s a custom template away.</p>
      <DocTypeGrid cards={byType} showCustomCard collapseAfter={8} />

      <p id="by-quality" className="mt-8 text-xs font-semibold uppercase tracking-[.16em] text-stone-500">By document quality</p>
      <DocTypeGrid cards={byQuality} />
    </section>

    <section id="industries" className="mx-auto max-w-6xl px-5 pt-20">
      <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Industries</p>
      <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-[-0.03em] text-stone-950 sm:text-4xl">
        If it&apos;s a document your team keys in by hand, it&apos;s a template in DocuBite.
      </h2>
      <p className="mt-4 max-w-xl text-[16.5px] leading-8 text-stone-600">
        Here&apos;s the paperwork each team drowns in — and the day it stops being manual.
      </p>

      <div className="mt-10 flex flex-col gap-4">
        {INDUSTRIES.map((industry) => (
          <article key={industry.name} className="grid gap-8 rounded-[1.75rem] rounded-tr-lg border border-stone-200 bg-white p-6 sm:p-7 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
            <div>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl rounded-tr-sm bg-emerald-50 text-emerald-700"><industry.icon className="h-[22px] w-[22px]" /></span>
              <h3 className="mt-4 font-display text-[22px] font-bold tracking-[-0.02em] text-stone-950">{industry.name}</h3>
              <p className="mt-2 text-[15px] leading-[1.55] text-stone-600">{industry.tagline}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {industry.tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-stone-600">{tag}</span>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <p className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[.08em] text-stone-400"><Clock className="h-3.5 w-3.5" />Today, by hand</p>
                <ul className="mt-3 flex flex-col gap-2.5">
                  {industry.before.map((item) => (
                    <li key={item} className="flex gap-2 text-[13.5px] leading-[1.45] text-stone-500">
                      <span className="mt-1.5 h-[5px] w-[5px] shrink-0 rounded-full bg-stone-300" />{item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[.08em] text-emerald-700"><Check className="h-3.5 w-3.5" />With DocuBite</p>
                <ul className="mt-3 flex flex-col gap-2.5">
                  {industry.after.map((item) => (
                    <li key={item} className="flex gap-2 text-[13.5px] leading-[1.45] text-emerald-900">
                      <Check className="mt-0.5 h-[15px] w-[15px] shrink-0 text-emerald-600" />{item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </article>
        ))}
      </div>

      <p className="mt-5 max-w-xl text-sm leading-7 text-stone-500">
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
