import { CheckCheck, Download, Sparkles, Upload } from "lucide-react"

const steps = [
  { n: "01", icon: Upload, title: "Ingest", text: "Drop PDFs and images into a workspace. Multi-page bundles, phone photos and image-only scans all go in the same door." },
  { n: "02", icon: Sparkles, title: "Extract", text: "Every page is parsed to text — print, scan or handwriting alike — and a template says which fields matter." },
  { n: "03", icon: CheckCheck, title: "Validate", text: "Fields land in a sheet with the low-confidence ones flagged. Correct them once and the record is settled." },
  { n: "04", icon: Download, title: "Automate", text: "Search across everything, share a file by link, and export clean CSV into the workflow you already run." },
]

export function Workflow() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">How it works</p>
      <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-[-0.03em] text-stone-950 sm:text-4xl">
        Four steps between a supplier’s PDF and a row you trust.
      </h2>

      <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => (
          <article key={step.n} className="rounded-[2rem] rounded-tr-md border border-stone-200 bg-white p-6 transition-shadow hover:shadow-[0_24px_60px_-40px_rgba(41,37,36,.5)]">
            <div className="flex items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl rounded-tr-sm bg-emerald-50 text-emerald-700"><step.icon className="h-5 w-5" /></span>
              <span className="font-display text-sm font-bold text-stone-300">{step.n}</span>
            </div>
            <h3 className="mt-5 font-display text-xl font-bold tracking-[-0.02em]">{step.title}</h3>
            <p className="mt-2 leading-7 text-stone-600">{step.text}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
