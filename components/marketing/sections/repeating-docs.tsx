import { FolderTree, Layers } from "lucide-react"

const cards = [
  {
    icon: Layers,
    title: "Recognises the shape, not the layout",
    text: "Define a template once — Invoice, Receipt, or your own custom form with the field keys and extraction instructions you need — and it reads every supplier's version of that document. Templates key on what a field means, not where it sits on the page, so a new supplier's layout doesn't need new setup.",
    chips: ["Invoice", "Receipt", "Custom fields", "Line-item tables"],
  },
  {
    icon: FolderTree,
    title: "Reasons across the whole pile, not one page",
    text: "A file gathers hundreds of documents into one live sheet, kept in folders you organise. Ask the assistant to total spend per supplier, surface the outliers, or check for gaps — and it reasons over every row at once, not a document at a time.",
    chips: ["Folders", "Multi-doc totals", "Cross-row checks", "CSV export"],
  },
]

/** Answers the second objection after "will it read a bad scan?" — "does this scale past one
 * document?" A template captured once and a file that keeps accepting new documents are what
 * make the answer yes. */
export function RepeatingDocs() {
  return (
    <section className="border-t border-stone-200 bg-stone-50">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Because the same documents keep coming</p>
        <h2 className="mt-3 max-w-xl font-display text-3xl font-bold leading-[1.08] tracking-[-0.03em] text-stone-950 sm:text-4xl">
          Set it up once. It keeps working as the pile grows.
        </h2>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
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
