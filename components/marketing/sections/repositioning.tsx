import { Reveal } from "@/components/marketing/reveal"

/** The repositioning's headline claim, shrunk from a card grid to a pull-quote band: the product
 * is not a one-way exporter that hands off a CSV and disappears, it's a spreadsheet the extracted
 * data lives in. The supporting detail lives elsewhere on the page (ExtractionCore, AiBand), so
 * this section only has to make the one claim, loudly. */
export function Repositioning() {
  return (
    <section className="border-y border-cream-200 bg-cream-100">
      <div className="perforation text-cream-200" aria-hidden />
      <div className="mx-auto max-w-4xl px-5 py-20 text-center">
        <Reveal>
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Not an exporter. A spreadsheet.</p>
          <p className="mx-auto mt-5 max-w-3xl font-display text-3xl font-bold leading-[1.15] tracking-[-0.03em] text-stone-950 sm:text-5xl sm:leading-[1.1]">
            Most tools hand you a <span className="text-amber-600">CSV</span> and wish you luck.{" "}
            <span className="text-emerald-600">DocuBite hands you the grid.</span>
          </p>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-7 text-stone-600">
            The extracted data doesn&apos;t leave to become someone else&apos;s problem. It lands in a live workbook you total, filter, formula over and reason about — and it never loses the thread back to where each number came from.
          </p>
        </Reveal>
        <div className="mx-auto mt-9 flex items-center justify-center gap-2" aria-hidden>
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <span className="h-2 w-2 rounded-full bg-emerald-600" />
          <span className="h-2 w-2 rounded-full bg-amber-400" />
        </div>
      </div>
      <div className="perforation text-cream-200" aria-hidden />
    </section>
  )
}
