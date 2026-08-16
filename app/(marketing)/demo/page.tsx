import { DemoForm } from "@/components/marketing/demo-form"
import { Toaster } from "@/components/ui/sonner"
import { TRIAL_DAYS } from "@/lib/plans"
import { CalendarClock, MessagesSquare, Sparkles } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Book a demo",
  description: "See DocuBite read your own documents. Twenty minutes, no slides, bring the file that gives you the most trouble.",
}

const points = [
  { icon: Sparkles, title: "We run your documents, not ours", text: "Send the invoice, receipt or handwritten note that everything else chokes on and we will put it through live." },
  { icon: CalendarClock, title: "Twenty minutes, no slide deck", text: "Enough to see ingestion, extraction and the review sheet end to end, and to decide whether it fits your workflow." },
  { icon: MessagesSquare, title: "Straight answers on security", text: "Where documents are stored, what reaches a model, what is logged. Bring your IT questions along." },
]

export default function DemoPage() {
  return (
    <section className="mx-auto grid max-w-6xl gap-12 px-5 py-16 lg:grid-cols-[1fr_.9fr] lg:py-20">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Book a demo</p>
        <h1 className="mt-3 max-w-xl font-display text-[2.4rem] font-bold leading-[1.05] tracking-[-0.04em] text-stone-950 sm:text-5xl">
          Bring your worst document. We will read it live.
        </h1>
        <p className="mt-6 max-w-lg text-lg leading-8 text-stone-600">
          Or skip the call entirely — the {TRIAL_DAYS}-day{" "}
          <Link href="/signup" className="font-medium text-emerald-800 underline underline-offset-4">free trial</Link>{" "}
          needs no credit card and takes about a minute to start.
        </p>

        <div className="mt-10 space-y-7">
          {points.map((point) => (
            <div key={point.title} className="flex gap-4">
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl rounded-tr-sm bg-emerald-50 text-emerald-700"><point.icon className="h-5 w-5" /></span>
              <div>
                <h2 className="font-display text-lg font-bold tracking-[-0.02em] text-stone-900">{point.title}</h2>
                <p className="mt-1 max-w-md leading-7 text-stone-600">{point.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <DemoForm />
        {/* The marketing layout has no Toaster of its own — this is the only page under it that
            raises one, so it mounts here rather than in the shared layout. */}
        <Toaster richColors position="bottom-right" />
      </div>
    </section>
  )
}
