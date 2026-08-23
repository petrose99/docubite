import { CheckCheck, Download, Sparkles, Upload } from "lucide-react"

const steps = [
  { n: "01", icon: Upload, title: "Ingest", text: "Drop files or a whole folder into a workspace — up to 100 a batch, page ranges if you only need some of a PDF. Duplicates are caught before they cost anything." },
  { n: "02", icon: Sparkles, title: "Extract", text: "Every page is parsed to text, whether it's print, a scan or handwriting, and a template says which fields matter." },
  { n: "03", icon: CheckCheck, title: "Validate", text: "Low-confidence values arrive tinted amber; missing required fields show red. Review keeps your corrections separate from the raw extraction, with an audit trail per document." },
  { n: "04", icon: Download, title: "Automate", text: "Reuse the setup on every repeat document, share by link as a view, a sandbox or an edit, and export to XLSX or CSV for the workflow you already run." },
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
