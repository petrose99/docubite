import { Reveal } from "@/components/marketing/reveal"
import { FileSearch, ShieldAlert, Sparkles } from "lucide-react"

const cells = [
  {
    icon: ShieldAlert,
    title: "Low-confidence values, flagged not hidden",
    text: "Every field the model was unsure about is scored and tinted amber in the sheet, so a misread total is something you catch, not something you discover downstream.",
    tint: "bg-amber-50",
  },
  {
    icon: Sparkles,
    title: "The first document proposes the columns",
    text: "Upload one sample and DocuBite suggests 3–12 typed fields off the document itself — line-item tables included — before you write a single template by hand.",
    tint: "bg-emerald-50",
  },
]

/** Sits right under the hero to make the repositioning's central claim before anything else: the
 * messy document is the input DocuBite is built for, not a fallback path. Bento layout: one big
 * before/after cell plus two smaller depth cells, mixed tints, staggered reveals. */
export function ExtractionCore() {
  return (
    <section id="extraction" className="mx-auto max-w-6xl px-5 py-20">
      <Reveal>
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Any document in, structured data out</p>
        <h2 className="mt-3 max-w-2xl font-display text-4xl font-bold leading-[1.05] tracking-[-0.035em] text-stone-950 sm:text-5xl">
          The messy document is the <span className="text-emerald-600">normal case.</span> We built for it.
        </h2>
      </Reveal>

      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        <Reveal className="lg:row-span-2">
          <article className="flex h-full flex-col justify-center rounded-[2rem] rounded-tr-md border border-stone-200 bg-white p-7">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl rounded-tr-sm bg-emerald-50 text-emerald-700"><FileSearch className="h-5 w-5" /></span>
            <h3 className="mt-5 font-display text-xl font-bold tracking-[-0.02em] text-stone-950">A scanned PDF is just a picture of a page</h3>
            <p className="mt-2.5 max-w-md text-[0.95rem] leading-6 text-stone-600">
              DocuBite parses every page to text first — print, scan, photo or handwriting alike — then structures it into the exact fields your template asks for. Nothing is skipped for being low quality.
            </p>

            <div className="mt-6 flex flex-col items-center gap-2 sm:flex-row sm:items-stretch">
              <div className="doc-scan relative w-full max-w-[15rem] -rotate-1 overflow-hidden rounded-lg border border-stone-200 bg-stone-100 p-4 shadow-[0_20px_40px_-28px_rgba(0,0,0,.4)]">
                <div className="flex items-center justify-between">
                  <div className="h-2 w-1/3 rounded-full bg-stone-400" />
                  <span className="text-[9px] font-bold uppercase tracking-[.1em] text-stone-400">Scanned</span>
                </div>
                <div className="mt-3.5 space-y-1.5">
                  <div className="h-1.5 w-[78%] rounded-full bg-stone-300" />
                  <div className="h-1.5 w-[60%] rounded-full bg-stone-300" />
                  <div className="h-1.5 w-[70%] rounded-full bg-stone-300" />
                </div>
              </div>

              <div className="z-10 inline-flex shrink-0 items-center gap-1.5 self-center rounded-full bg-emerald-950 px-3.5 py-1.5 text-xs font-bold text-white shadow-[0_8px_18px_-8px_rgba(4,120,87,.7)]">
                Extract
              </div>

              <div className="w-full max-w-[15rem] rounded-2xl border border-stone-200 bg-white px-2.5 py-1.5 shadow-[0_24px_50px_-30px_rgba(41,37,36,.5)]">
                <table className="w-full border-collapse text-xs">
                  <tbody>
                    <tr className="border-b border-stone-100"><th className="px-1 py-1.5 text-left font-medium text-stone-500">Supplier</th><td className="px-1 py-1.5 text-right font-semibold text-stone-900">Meridian</td></tr>
                    <tr className="border-b border-stone-100"><th className="px-1 py-1.5 text-left font-medium text-stone-500">Tax</th><td className="px-1 py-1 text-right"><span className="inline-flex items-center rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-semibold tabular-nums text-amber-800">102.50</span></td></tr>
                    <tr><th className="px-1 py-1.5 text-left font-medium text-stone-500">Total</th><td className="px-1 py-1.5 text-right font-bold tabular-nums text-stone-900">615.00</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </article>
        </Reveal>

        {cells.map((cell, index) => (
          <Reveal key={cell.title} delay={0.1 * (index + 1)}>
            <article className={`rounded-[2rem] rounded-tr-md border border-stone-200 ${cell.tint} p-6`}>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl rounded-tr-sm bg-white text-emerald-700"><cell.icon className="h-5 w-5" /></span>
              <h3 className="mt-5 font-display text-lg font-bold tracking-[-0.02em] text-stone-950">{cell.title}</h3>
              <p className="mt-2.5 text-[0.9rem] leading-6 text-stone-700">{cell.text}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
