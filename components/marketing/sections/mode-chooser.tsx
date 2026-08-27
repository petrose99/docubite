import { ArrowRight, Landmark, Stethoscope } from "lucide-react"
import Link from "next/link"

const modes = [
  {
    href: "/accounting",
    icon: Landmark,
    name: "Accounting & bookkeeping",
    tagline: "Invoices and receipts into a live sheet, self-serve.",
    cta: "See accounting →",
  },
  {
    href: "/clinical",
    icon: Stethoscope,
    name: "Clinical documentation",
    tagline: "Dictate a case, get back a proper report.",
    cta: "See clinical →",
  },
] as const

/** The homepage's job is to sort a visitor into one of the two positionings this app actually
 * ships under (Workspace.productMode) before it says anything deep about either — a page trying
 * to pitch both an accounting firm and a clinician at once is the thing WP6 exists to fix. */
export function ModeChooser() {
  return (
    <section id="modes" className="mx-auto max-w-6xl px-5 py-16">
      <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">What are you reading?</p>
      <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-[-0.03em] text-stone-950 sm:text-4xl">
        DocuBite is built two ways. Pick yours.
      </h2>

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        {modes.map((mode) => (
          <Link key={mode.href} href={mode.href} className="group flex flex-col gap-3 rounded-[1.75rem] rounded-tr-lg border border-stone-200 bg-white p-7 transition-colors hover:border-emerald-300 hover:bg-emerald-50/30">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl rounded-tr-sm bg-emerald-50 text-emerald-700"><mode.icon className="h-[22px] w-[22px]" /></span>
            <h3 className="font-display text-xl font-bold tracking-[-0.02em] text-stone-950">{mode.name}</h3>
            <p className="text-sm leading-6 text-stone-600">{mode.tagline}</p>
            <span className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
              {mode.cta}<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
