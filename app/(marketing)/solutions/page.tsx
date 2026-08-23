import { DocTypeGrid, type DocCard } from "@/components/marketing/sections/doc-type-grid"
import { TRIAL_DAYS } from "@/lib/plans"
import { Check, Clock, FlaskConical, Landmark, Truck, type LucideIcon } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Solutions",
  description: "One tool for every document your team retypes by hand — see the before/after for your industry.",
}

const byType: DocCard[] = [
  { name: "Invoices", text: "Supplier, number, dates, line items, tax", icon: "FileText" },
  { name: "Receipts", text: "Merchant, date, total, VAT, payment method", icon: "Receipt" },
  { name: "Bank statements", text: "Multi-page transaction tables into rows", icon: "Landmark" },
  { name: "Purchase orders", text: "PO number, supplier, line items, totals", icon: "Package" },
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

type Industry = {
  icon: LucideIcon
  name: string
  tagline: string
  tags: string[]
  before: string[]
  after: string[]
}

const industries: Industry[] = [
  {
    icon: Landmark,
    name: "Finance & bookkeeping",
    tagline: "Month-end shouldn't mean a keyboard and a shoebox of receipts.",
    tags: ["Supplier invoices", "Expense receipts", "Bank & card statements", "Remittance advice"],
    before: [
      "Open each PDF and retype supplier, date, net, VAT, total",
      "Squint at photographed receipts and faded thermal paper",
      "Hunt for the source PDF when a figure looks wrong",
    ],
    after: [
      "Drop the whole folder of invoices, receipts and statements, and get back the missing months and duplicates first",
      "Fields land as rows; low-confidence ones flag themselves",
      "Total per supplier with the assistant, click any figure to its line",
    ],
  },
  {
    icon: FlaskConical,
    name: "Healthcare & clinics",
    tagline: "Less admin between the patient and the record.",
    tags: ["Referral letters", "Lab result sheets", "Insurance claim forms", "Intake & consent forms"],
    before: [
      "Re-key referral and intake forms into the system by hand",
      "Copy values off faxed, scanned or handwritten result sheets",
      "Chase which form a value came from when a claim is queried",
    ],
    after: [
      "Scan or upload the form — handwriting and faxes read fine",
      "One template pulls the same fields every time, into a clean row",
      "Every value stays pinned to the form it was read from, for the audit trail",
    ],
  },
  {
    icon: Truck,
    name: "Logistics & supply chain",
    tagline: "When the paperwork moves slower than the freight.",
    tags: ["Bills of lading", "Delivery notes / PODs", "Packing lists", "Customs declarations"],
    before: [
      "Type BOL and delivery-note numbers off crumpled, signed paper",
      "Match packing lists to invoices, line by line",
      "Key customs fields under a clearance deadline",
    ],
    after: [
      "Photograph the signed POD or drop the BOL PDF",
      "Line items come out as rows — quantities and refs structured, not a blob",
      "Ask the assistant to flag mismatches across the whole shipment folder, and diff this month's paperwork against last month's",
    ],
  },
]

export default function SolutionsPage() {
  return <>
    <section className="mx-auto max-w-6xl px-5 pt-16 pb-2 lg:pt-20">
      <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Solutions</p>
      <h1 className="mt-3.5 max-w-3xl font-display text-4xl font-bold leading-[1.04] tracking-[-0.04em] text-stone-950 sm:text-5xl">
        One tool for every document your team retypes.
      </h1>
      <p className="mt-4 max-w-xl text-lg leading-8 text-stone-600">
        Invoices, receipts, statements, forms — clean or crumpled. Pick your document type or your industry below.
      </p>
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
        Where teams use it.
      </h2>
      <p className="mt-4 max-w-xl text-[16.5px] leading-8 text-stone-600">
        Here&apos;s the paperwork each team drowns in — and the day it stops being manual.
      </p>

      <div className="mt-10 flex flex-col gap-4">
        {industries.map((industry) => (
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
            Start a {TRIAL_DAYS}-day free trial, no credit card — or bring a sample and we&apos;ll build the template with you.
          </p>
          <div className="relative mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup" className="inline-flex h-[50px] items-center justify-center rounded-xl bg-white px-6 text-[15px] font-semibold text-emerald-800">Start free trial</Link>
            <Link href="/demo" className="inline-flex h-[50px] items-center justify-center rounded-xl border border-white/25 px-6 text-[15px] font-semibold text-white">Book a demo</Link>
          </div>
        </div>
      </div>
    </section>
  </>
}
