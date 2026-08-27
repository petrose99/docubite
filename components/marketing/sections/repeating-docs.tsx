import { Reveal } from "@/components/marketing/reveal"
import { GitCompareArrows, Layers, Sparkles } from "lucide-react"

const points = [
  {
    icon: Sparkles,
    title: "The first document builds the sheet",
    text: "Upload it and DocuBite proposes the columns — 3 to 12 typed fields read off the document itself, line-item tables included. Want one more? Describe it in plain English and it appears.",
  },
  {
    icon: Layers,
    title: "The second one is recognised on sight",
    text: "Every extraction saves the document's shape — what it means, not where it sits — so a new supplier's layout isn't new setup. Layout fingerprinting matches the next upload before any AI runs.",
  },
  {
    icon: GitCompareArrows,
    title: "Every one after gets compared to last time",
    text: "This month's statement against last month's: fields that appeared, fields that went missing, values that moved, line items that changed. The run diff is waiting when extraction finishes.",
  },
]

/** Answers the "does this scale past one document?" objection as an arc across repeat documents.
 * First of the RepeatingDocs/FolderReport pair — split layout, mock on an emerald-tinted panel;
 * FolderReport mirrors the direction on a cream panel. */
export function RepeatingDocs() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
        <Reveal>
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Because the same documents keep coming</p>
          <h2 className="mt-3 max-w-xl font-display text-4xl font-bold leading-[1.05] tracking-[-0.035em] text-stone-950 sm:text-5xl">
            The first one takes a minute. <span className="text-emerald-600">The rest take nothing.</span>
          </h2>

          <div className="mt-8 space-y-6">
            {points.map((point) => (
              <div key={point.title} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl rounded-tr-sm bg-emerald-50 text-emerald-700"><point.icon className="h-5 w-5" /></span>
                <div>
                  <h3 className="font-display text-lg font-bold tracking-[-0.02em] text-stone-950">{point.title}</h3>
                  <p className="mt-1.5 text-[0.95rem] leading-6 text-stone-600">{point.text}</p>
                </div>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.15}>
          <div className="rotate-1 rounded-[2rem] rounded-tr-lg bg-emerald-50 p-6 sm:p-8">
            <div className="overflow-hidden rounded-[1.4rem] rounded-tr-md border border-stone-200 bg-white shadow-[0_30px_70px_-48px_rgba(41,37,36,.55)]">
              <div className="flex items-center gap-2 border-b border-stone-100 px-3.5 py-2.5">
                <Layers className="h-3.5 w-3.5 text-emerald-700" />
                <span className="text-sm font-semibold text-stone-800">march-phone-bill.pdf</span>
              </div>
              <div className="space-y-3 p-4">
                <p className="text-[0.85rem] leading-6 text-stone-700">
                  Looks like a phone bill — same columns as <span className="font-mono text-xs">march.pdf</span>. Use the same setup?
                </p>
                <div className="flex gap-2">
                  <span className="rounded-full bg-emerald-950 px-3 py-1.5 text-xs font-semibold text-white">Use same setup</span>
                  <span className="rounded-full border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-600">Start fresh</span>
                </div>
                <div className="flex flex-wrap gap-1.5 border-t border-stone-100 pt-3">
                  {["Shape memory", "Matched before AI", "Run diff vs. last month"].map((chip) => (
                    <span key={chip} className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-xs font-medium text-stone-600">{chip}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
