import { Mic, Route, ShieldCheck } from "lucide-react"

const cards = [
  {
    icon: Mic,
    title: "Just talk. No menu first.",
    text: "There's no dropdown to fill in before you start recording. Dictate freely — a finance note, a pathology read, a delivery update, a to-do — and DocuBite works out what it's listening to as you go.",
  },
  {
    icon: Route,
    title: "Routed to the right shape automatically",
    text: "The transcript is matched against what a report of that kind actually sounds like, then rendered the way it should read — a SOAP note, a table, an email draft, a bullet summary — no format picked by hand.",
  },
  {
    icon: ShieldCheck,
    title: "The same trust guarantee as your documents",
    text: "A deterministic block of extracted fields sits alongside the write-up, built only from what was said. Nothing in the structured data is invented to fill a gap — it's left for you to fill in.",
  },
]

/** Dictation's marketing debut: same card-grid pattern as Repositioning, positioned right after
 * it so the page establishes "documents become a trusted grid" first, then "or skip the document
 * and just talk" as the second way into that same system. The animated demo itself lives in the
 * hero (alongside ExtractionDemo) rather than repeated here. */
export function DictationPitch() {
  return (
    <section id="dictation" className="mx-auto max-w-6xl px-5 py-20">
      <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Or skip the document entirely</p>
      <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold leading-[1.08] tracking-[-0.03em] text-stone-950 sm:text-4xl">
        Nothing to scan? Just say it.
      </h2>
      <p className="mt-4 max-w-xl text-lg leading-7 text-stone-600">
        Not everything arrives as a PDF. Dictation is the other door into DocuBite: talk instead of type, and get back a proper report — not just a raw transcript.
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
