import { Reveal } from "@/components/marketing/reveal"
import { Check, FileText } from "lucide-react"

const points = [
  "Low-confidence values tinted amber in the sheet; missing required fields red",
  "Reviewed data kept separate from the raw extraction — corrections never overwrite the evidence",
  "A full audit trail per document: received, extracted, reviewed, edited — who and when",
  "Search every folder by content — hybrid semantic and keyword search, with natural-language filters",
]

/** The trust-building close before pricing: a sheet of numbers with no working shown is a claim
 * nobody checks. This is where "click a cell, see the source" gets its own moment rather than
 * staying a bullet inside the triptych above. */
export function Provenance() {
  return (
    <section className="border-t border-cream-200 bg-cream-100">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-20 lg:grid-cols-[1.05fr_0.95fr]">
        <Reveal>
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Persistent provenance</p>
          <h2 className="mt-3 font-display text-4xl font-bold leading-[1.05] tracking-[-0.035em] text-stone-950 sm:text-5xl">
            A sheet of numbers is a claim <span className="text-emerald-600">nobody is checking.</span>
          </h2>
          <p className="mt-5 max-w-lg text-lg leading-7 text-stone-600">
            So DocuBite keeps the thread. Click any cell and the original document opens to the exact line the value came from — the page, the box on the scan, highlighted. Hand-edit a value and its stale source pin drops, because a highlight over the old figure would be worse than none.
          </p>
          <ul className="mt-6 space-y-3">
            {points.map((point) => (
              <li key={point} className="flex gap-2.5 text-[0.95rem] leading-6 text-stone-800">
                <Check aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />{point}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={0.15} className="rotate-1 overflow-hidden rounded-[1.4rem] rounded-tr-md border border-cream-200 bg-white shadow-[0_40px_80px_-50px_rgba(41,37,36,.5)]">
          <div className="flex items-center gap-2 border-b border-stone-100 px-3.5 py-2.5">
            <FileText className="h-3.5 w-3.5 text-stone-400" />
            <span className="text-sm font-semibold text-stone-800">invoice-0481.pdf</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-stone-100 bg-emerald-50 px-3.5 py-2 text-xs text-emerald-800">
            <span className="rounded bg-white/70 px-1.5 py-0.5 font-semibold">&quot;473.33&quot;</span>
            <span className="text-emerald-600">page 1</span>
          </div>
          <div className="bg-stone-100 p-5">
            <div className="rounded-md border border-stone-200 bg-white p-5 shadow-[0_8px_20px_-14px_rgba(0,0,0,.3)]">
              <div className="h-2 w-[38%] rounded-full bg-stone-800" />
              <div className="mt-1.5 h-1.5 w-1/4 rounded-full bg-stone-300" />
              <div className="mt-5 space-y-2">
                <div className="h-1.5 w-[82%] rounded-full bg-stone-200" />
                <div className="h-1.5 w-[64%] rounded-full bg-stone-200" />
                <div className="h-1.5 w-[73%] rounded-full bg-stone-200" />
              </div>
              <div className="mt-5 flex items-center justify-between border-t border-stone-100 pt-3.5">
                <div className="h-1.5 w-[22%] rounded-full bg-stone-200" />
                <div className="rounded bg-emerald-400/20 px-2 py-1 outline outline-2 outline-emerald-500">
                  <span className="font-mono text-xs font-bold text-emerald-800">Tax&nbsp;&nbsp;473.33</span>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
