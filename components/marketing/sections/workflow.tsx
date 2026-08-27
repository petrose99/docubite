import { Reveal } from "@/components/marketing/reveal"
import { CheckCheck, Download, Sparkles, Upload } from "lucide-react"

const steps = [
  { n: "01", icon: Upload, title: "Ingest", text: "Drop files or a whole folder into a workspace — up to 100 a batch, page ranges if you only need some of a PDF. Duplicates are caught before they cost anything." },
  { n: "02", icon: Sparkles, title: "Extract", text: "Every page is parsed to text — print, scan or handwriting alike — and a template says which fields matter." },
  { n: "03", icon: CheckCheck, title: "Validate", text: "Low-confidence values arrive tinted amber; missing required fields show red. Review keeps your corrections separate from the raw extraction, with an audit trail per document." },
  { n: "04", icon: Download, title: "Automate", text: "Reuse the setup on every repeat document, share by link — view, sandbox or edit — and export to XLSX or CSV for the workflow you already run." },
]

export function Workflow() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <Reveal>
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">How it works</p>
        <h2 className="mt-3 max-w-2xl font-display text-4xl font-bold tracking-[-0.035em] text-stone-950 sm:text-5xl">
          Four steps between a supplier&rsquo;s PDF and a row you trust.
        </h2>
      </Reveal>

      <div className="relative mt-16">
        {/* rail: solid line on mobile (vertical), dotted perforation on lg (horizontal) */}
        <div className="absolute left-[1.15rem] top-2 h-[calc(100%-1rem)] w-px bg-stone-200 lg:hidden" aria-hidden />
        <div className="perforation absolute inset-x-0 top-5 hidden text-stone-300 lg:block" aria-hidden />

        <div className="grid gap-10 lg:grid-cols-4 lg:gap-6">
          {steps.map((step, index) => (
            <Reveal key={step.n} delay={0.1 * index}>
              <article className="relative flex gap-5 pl-2 lg:block lg:pl-0">
                <span className="relative z-10 mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-emerald-950 lg:mb-6">{step.n}</span>
                <div className="lg:pt-1">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl rounded-tr-sm bg-emerald-50 text-emerald-700"><step.icon className="h-5 w-5" /></span>
                  <h3 className="mt-4 font-display text-xl font-bold tracking-[-0.02em] text-stone-950">{step.title}</h3>
                  <p className="mt-2 leading-7 text-stone-600">{step.text}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
