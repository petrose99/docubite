import { GitCompareArrows, Layers, Sparkles } from "lucide-react"

const cards = [
  {
    icon: Sparkles,
    title: "The first one proposes the columns",
    text: "Upload it and DocuBite reads off 3 to 12 typed fields, line-item tables included. Want one more? Describe it in plain English and it appears.",
    chips: ["Typed columns", "Line-item tables", "Custom fields"],
  },
  {
    icon: Layers,
    title: "The next one is recognised on sight",
    text: "A new supplier's layout isn't new setup. DocuBite matches the shape before any AI runs — one click to reuse it, and it costs nothing.",
    chips: ["Matched before AI", "Use same setup"],
  },
  {
    icon: GitCompareArrows,
    title: "Every one after gets diffed",
    text: "This month's statement against last month's: fields added, fields missing, values that moved. The diff is waiting when extraction finishes.",
    chips: ["Fields added / missing", "Changed values"],
  },
]

/** Answers the "does this scale past one document?" objection: the first one proposes the
 * columns, the next is recognised by shape before any AI runs, and every one after is diffed
 * against the last of its kind. Setup is a one-time cost that pays itself back. */
export function RepeatingDocs() {
  return (
    <section className="border-t border-stone-200 bg-stone-50">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Recurring documents</p>
        <h2 className="mt-3 max-w-xl font-display text-3xl font-bold leading-[1.08] tracking-[-0.03em] text-stone-950 sm:text-4xl">
          Set up once. Repeats read themselves.
        </h2>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {cards.map((card) => (
            <article key={card.title} className="rounded-[2rem] rounded-tr-md border border-stone-200 bg-white p-7">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl rounded-tr-sm bg-emerald-50 text-emerald-700"><card.icon className="h-5 w-5" /></span>
              <h3 className="mt-5 font-display text-xl font-bold tracking-[-0.02em] text-stone-950">{card.title}</h3>
              <p className="mt-2.5 text-[0.95rem] leading-6 text-stone-600">{card.text}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {card.chips.map((chip) => (
                  <span key={chip} className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-stone-600">{chip}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
