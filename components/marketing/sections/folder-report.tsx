import { Check, Crosshair, FolderTree } from "lucide-react"

const points = [
  "Counts the pile by kind — 5 phone bills, 3 invoices, 1 something else",
  "Finds the missing months in a monthly series",
  "Catches exact duplicates by checksum and near-duplicates by content",
  "Lists what needs attention — each item opens the source with the offending value highlighted",
  "One-line AI summary if you ask for it. Only if you ask.",
]

/** The flagship pile-scale claim, given its own moment: nobody reads forty documents by hand, so
 * the folder reports on itself. Deterministic arithmetic, free and on by default — the opposite of
 * the AI surfaces above it. Split-section layout mirrors provenance.tsx. */
export function FolderReport() {
  return (
    <section className="border-t border-stone-200 bg-white">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-20 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">The folder report</p>
          <h2 className="mt-3 font-display text-3xl font-bold leading-[1.1] tracking-[-0.03em] text-stone-950 sm:text-4xl">
            Nobody reads a pile of forty documents. So the folder does it.
          </h2>
          <p className="mt-5 max-w-lg text-lg leading-7 text-stone-600">
            Drop three or more files in and DocuBite reports on the batch before you&apos;ve opened a single one: what&apos;s in the pile, what&apos;s missing from it, and what&apos;s in it twice. It&apos;s arithmetic, not AI — free, deterministic, and there every time.
          </p>
          <ul className="mt-6 space-y-3">
            {points.map((point) => (
              <li key={point} className="flex gap-2.5 text-[0.95rem] leading-6 text-stone-800">
                <Check aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />{point}
              </li>
            ))}
          </ul>
        </div>

        <div className="overflow-hidden rounded-[1.4rem] rounded-tr-md border border-stone-200 bg-white shadow-[0_40px_80px_-50px_rgba(41,37,36,.5)]">
          <div className="flex items-center gap-2 border-b border-stone-100 px-3.5 py-2.5">
            <FolderTree className="h-3.5 w-3.5 text-stone-400" />
            <span className="text-sm font-semibold text-stone-800">Q1 utilities · 8 documents</span>
            <span className="ml-auto rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs font-medium text-stone-500">Report · free</span>
          </div>
          <div className="divide-y divide-stone-100 text-sm">
            <div className="flex items-center gap-2 px-3.5 py-2.5 text-stone-700">
              <span className="font-medium text-stone-500">By kind:</span>
              <span className="font-semibold text-stone-900">5 phone bills · 3 invoices</span>
            </div>
            <div className="flex items-center gap-2 bg-amber-50 px-3.5 py-2.5 text-amber-800">
              <span className="font-semibold">Missing month — March</span>
            </div>
            <div className="px-3.5 py-2.5 text-stone-700">
              <span className="font-medium text-stone-500">2 near-duplicates · </span>
              <span className="font-mono text-xs text-stone-800">invoice-0481.pdf ↔ invoice-0481 (1).pdf</span>
            </div>
            <div className="flex items-center gap-2 px-3.5 py-2.5 text-stone-700">
              <Crosshair className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>Tax doesn&apos;t match line items — <span className="font-mono text-xs">acme-feb.pdf</span></span>
            </div>
          </div>
          <div className="flex items-center border-t border-stone-100 bg-stone-50 px-3.5 py-3">
            <span className="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs font-semibold text-stone-600">Summarise with AI</span>
          </div>
        </div>
      </div>
    </section>
  )
}
