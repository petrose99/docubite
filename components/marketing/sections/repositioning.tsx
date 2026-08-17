import { FileSpreadsheet, ScanSearch, Sparkles } from "lucide-react"

const cards = [
  {
    icon: FileSpreadsheet,
    title: "Documents become rows",
    text: "Drop a file into a workspace and its fields appear as a row the moment extraction finishes — print, scan, photo or handwriting, all through the same door. The file is the sheet, not a view of one.",
  },
  {
    icon: Sparkles,
    title: "An assistant that works the grid",
    text: "Ask a question in plain English. The assistant reads the sheet as you see it, does the arithmetic, adds columns and fills formulas — then links every cell it touched so you can check it, not trust it.",
  },
  {
    icon: ScanSearch,
    title: "Every cell traces to its source",
    text: "Click a value and the original document opens to the exact line it was read from, highlighted on the page. Uncertain fields arrive flagged for review — never quietly filled in.",
  },
]

/** The repositioning's headline claim: the product is not a one-way exporter that hands off a
 * CSV and disappears, it's a spreadsheet the extracted data lives in. */
export function Repositioning() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Not an exporter. A spreadsheet.</p>
      <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold leading-[1.08] tracking-[-0.03em] text-stone-950 sm:text-4xl">
        Most tools hand you a CSV and wish you luck. DocuBite hands you the grid.
      </h2>
      <p className="mt-4 max-w-xl text-lg leading-7 text-stone-600">
        The extracted data doesn&apos;t leave to become someone else&apos;s problem. It lands in a live workbook you total, filter, formula over and reason about — and it never loses the thread back to where each number came from.
      </p>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {cards.map((card) => (
          <article key={card.title} className="rounded-[2rem] rounded-tr-md border border-stone-200 bg-white p-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl rounded-tr-sm bg-emerald-50 text-emerald-700"><card.icon className="h-5 w-5" /></span>
            <h3 className="mt-5 font-display text-xl font-bold tracking-[-0.02em] text-stone-950">{card.title}</h3>
            <p className="mt-2.5 text-[0.95rem] leading-6 text-stone-600">{card.text}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
