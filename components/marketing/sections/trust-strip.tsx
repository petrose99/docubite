/** Deliberately not fake customer logos: the product has no named references to show yet, and
 * inventing six greyed-out wordmarks is the one thing on a marketing page a finance buyer will
 * check. These are the document kinds and formats it handles, which is a claim we can stand on. */
const items = ["Invoices", "Receipts", "Bank statements", "Handwritten notes", "Scanned PDFs", "Photos", "Multi-page bundles", "Whole folders"]

export function TrustStrip() {
  return (
    <section className="border-y border-stone-200 bg-stone-50">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <p className="text-center text-xs font-semibold uppercase tracking-[.18em] text-stone-500">Reads what your inbox actually receives</p>
        <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2.5">
          {items.map((item) => (
            <li key={item} className="rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-sm font-medium text-stone-600">{item}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
