import { Reveal } from "@/components/marketing/reveal"
import { DictationDemo } from "@/components/marketing/sections/dictation-demo"
import { AudioLines, FileCheck2, Mic } from "lucide-react"

const points = [
  {
    icon: Mic,
    title: "Just talk. No menu first.",
    text: "There's no dropdown to fill in before you start recording. Dictate freely — a finance note, a pathology read, a delivery update, a to-do — and DocuBite works out what it's listening to as you go, with the transcript appearing live as you speak.",
  },
  {
    icon: AudioLines,
    title: "Every value, provenanced to a moment",
    text: "Click a field in the synoptic block and hear the exact seconds it was said — not just what was extracted, but the words that produced it. The same trust guarantee as a document's source pin, spoken instead of scanned.",
  },
  {
    icon: FileCheck2,
    title: "A report you sign off on, not just a transcript",
    text: "The write-up is drafted in the shape it should read — a SOAP note, a table, an email — with versioning, so a correction after the fact doesn't overwrite what was first said.",
  },
]

/** Dictation's flagship moment: the differentiator gets the demo (moved out of the hero, where it
 * was cramped alongside ExtractionDemo) and the larger H2 scale. Split layout, amber-tinted panel
 * for the demo, floating "Nothing invented" chip. */
export function DictationPitch() {
  return (
    <section id="dictation" className="mx-auto max-w-6xl px-5 py-20">
      <div className="grid items-center gap-14 lg:grid-cols-[0.95fr_1.05fr]">
        <Reveal>
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Or skip the document entirely</p>
          <h2 className="mt-3 max-w-xl font-display text-4xl font-bold leading-[1.05] tracking-[-0.035em] text-stone-950 sm:text-5xl">
            Nothing to scan? <span className="text-emerald-600">Just say it.</span>
          </h2>
          <p className="mt-5 max-w-lg text-lg leading-7 text-stone-600">
            Not everything arrives as a PDF. Dictation is the other door into DocuBite: talk instead of type, and get back a proper report — not just a raw transcript.
          </p>

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

        <Reveal delay={0.15} className="relative">
          <div className="rounded-[2rem] rounded-tr-lg bg-amber-50 p-6 sm:p-8">
            <DictationDemo />
          </div>
          <div className="docubite-float pointer-events-none absolute -left-4 -top-4 hidden items-center gap-1.5 rounded-xl rounded-tr-sm bg-emerald-950 px-3 py-1.5 text-[0.7rem] font-semibold text-emerald-100 shadow-[0_16px_36px_-20px_rgba(2,44,34,.8)] sm:flex">
            <FileCheck2 className="h-3.5 w-3.5 text-emerald-400" />Nothing invented
          </div>
        </Reveal>
      </div>
    </section>
  )
}
