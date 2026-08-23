import { Check } from "lucide-react"

const points = [
  "Image-only PDFs, faxes and photocopies — read, not refused",
  "Angled, low-light phone photos and faded thermal receipts",
  "Handwriting and margin notes captured as real values",
  "Long, multi-page bundles batched and stitched into one document",
  "Whole folders at a drop — up to 100 files a batch, duplicates caught on the way in",
]

/** Deliberately not fake customer logos: the product has no named references to show yet, and
 * inventing six greyed-out wordmarks is the one thing on a marketing page a finance buyer will
 * check. These are the document kinds and formats it handles, which is a claim we can stand on. */
const chips = ["Invoices", "Receipts", "Bank statements", "Handwritten notes", "Scanned PDFs", "Photos", "Multi-page bundles", "Whole folders"]

/** Sits right under the hero, merged with the old TrustStrip chip row: the same claim (messy
 * inputs are the normal case, not a fallback path) made once instead of twice in a row. The
 * before/after mock is CSS-only, matching ExtractionDemo's reasoning — no JS for something
 * decorative above the fold. */
export function ExtractionCore() {
  return (
    <section id="extract" className="mx-auto max-w-6xl px-5 py-20">
      <div className="grid items-center gap-14 lg:grid-cols-[1.02fr_0.98fr]">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Any document in, structured data out</p>
        <h2 className="mt-3 font-display text-3xl font-bold leading-[1.08] tracking-[-0.03em] text-stone-950 sm:text-4xl">
          Reads the documents other tools reject.
        </h2>
        <p className="mt-5 max-w-lg text-lg leading-7 text-stone-600">
          A scanned PDF is a picture of a page; a phone photo is worse. DocuBite parses every page to text first, whether it&apos;s print, a scan, a photo or handwriting, then structures it into the fields you asked for. Nothing is skipped for being low quality.
        </p>
        <ul className="mt-6 space-y-3">
          {points.map((point) => (
            <li key={point} className="flex gap-2.5 text-[0.95rem] leading-6 text-stone-800">
              <Check aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />{point}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col items-center">
        <div className="w-full max-w-[22rem] -rotate-1 rounded-lg border border-stone-200 bg-stone-100 p-4 shadow-[0_20px_40px_-28px_rgba(0,0,0,.4)]">
          <div className="flex items-center justify-between">
            <div className="h-2 w-1/3 rounded-full bg-stone-400" />
            <span className="text-[9px] font-bold uppercase tracking-[.1em] text-stone-400">Scanned · low quality</span>
          </div>
          <div className="mt-3.5 space-y-1.5">
            <div className="h-1.5 w-[78%] rounded-full bg-stone-300" />
            <div className="h-1.5 w-[60%] rounded-full bg-stone-300" />
            <div className="h-1.5 w-[70%] rounded-full bg-stone-300" />
          </div>
          <div className="mt-3.5 flex justify-end border-t border-dashed border-stone-300 pt-2.5">
            <div className="h-2 w-[30%] rounded-full bg-stone-400" />
          </div>
        </div>

        <div className="-my-1.5 z-10 inline-flex items-center gap-1.5 rounded-full bg-emerald-700 px-3.5 py-1.5 text-xs font-bold text-white shadow-[0_8px_18px_-8px_rgba(4,120,87,.7)]">
          Extract
        </div>

        <div className="w-full max-w-[22rem] rounded-2xl border border-stone-200 bg-white px-2.5 py-1.5 shadow-[0_24px_50px_-30px_rgba(41,37,36,.5)]">
          <table className="w-full border-collapse text-sm">
            <tbody>
              <tr className="border-b border-stone-100"><th className="px-1 py-2 text-left font-medium text-stone-500">Supplier</th><td className="px-1 py-2 text-right font-semibold text-stone-900">Meridian Print</td></tr>
              <tr className="border-b border-stone-100"><th className="px-1 py-2 text-left font-medium text-stone-500">Invoice #</th><td className="px-1 py-2 text-right font-semibold tabular-nums text-stone-900">MP-3321</td></tr>
              <tr className="border-b border-stone-100"><th className="px-1 py-2 text-left font-medium text-stone-500">Date</th><td className="px-1 py-2 text-right font-semibold text-stone-900">07 Aug 2026</td></tr>
              <tr className="border-b border-stone-100"><th className="px-1 py-2 text-left font-medium text-stone-500">Tax</th><td className="px-1 py-1.5 text-right"><span className="inline-flex items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-semibold tabular-nums text-amber-800">102.50 <span className="text-[9px] font-bold uppercase tracking-[.05em]">review</span></span></td></tr>
              <tr><th className="px-1 py-2 text-left font-medium text-stone-500">Total</th><td className="px-1 py-2 text-right font-bold tabular-nums text-stone-900">615.00</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      </div>

      <ul className="mt-14 flex flex-wrap items-center gap-2.5 border-t border-stone-200 pt-8">
        {chips.map((chip) => (
          <li key={chip} className="rounded-full border border-stone-200 bg-stone-50 px-3.5 py-1.5 text-sm font-medium text-stone-600">{chip}</li>
        ))}
      </ul>
    </section>
  )
}
