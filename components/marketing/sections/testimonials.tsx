import { Quote } from "lucide-react"

/** Placeholder personas, and labelled as such in the section note below. Attributing invented
 * quotes to invented firms is the kind of thing that stops being a placeholder the moment it
 * ships; the note keeps this honest until real references replace it. */
const testimonials = [
  {
    quote: "The receipts our clients photograph in the car park used to be the whole reason month-end ran late. They go in with everything else now.",
    name: "Practice manager",
    role: "12-person bookkeeping firm",
  },
  {
    quote: "It flags what it is unsure about instead of guessing confidently. That is the difference between a tool I check and a tool I trust.",
    name: "Finance lead",
    role: "Property management group",
  },
  {
    quote: "Handwritten delivery notes were a manual keying job nobody wanted. That queue does not exist any more.",
    name: "Operations director",
    role: "Regional wholesaler",
  },
]

export function Testimonials() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20">
      <h2 className="max-w-2xl font-display text-3xl font-bold tracking-[-0.03em] text-stone-950 sm:text-4xl">
        Built for the documents nobody wants to key in by hand.
      </h2>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {testimonials.map((testimonial) => (
          <figure key={testimonial.name} className="flex flex-col rounded-[2rem] rounded-tr-md border border-stone-200 bg-stone-50 p-6">
            <Quote aria-hidden className="h-6 w-6 text-emerald-600" />
            <blockquote className="mt-4 flex-1 text-[1.05rem] leading-7 text-stone-800">“{testimonial.quote}”</blockquote>
            <figcaption className="mt-6 border-t border-stone-200 pt-4 text-sm">
              <span className="block font-semibold text-stone-900">{testimonial.name}</span>
              <span className="block text-stone-500">{testimonial.role}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      <p className="mt-6 text-sm text-stone-400">Illustrative examples of the workflows DocuBite is designed for, not quotes from named customers.</p>
    </section>
  )
}
