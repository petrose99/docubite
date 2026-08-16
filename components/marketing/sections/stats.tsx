const stats = [
  { value: "9 fields", label: "captured from a standard invoice before you touch a template" },
  { value: "Page 1 → 40", label: "long scans batched and stitched, not truncated at the first request" },
  { value: "1 pass", label: "print, scans, photos and handwriting all read the same way" },
  { value: "0 logs", label: "document bodies and prompts containing them are never written down" },
]

/** The deep-emerald "ink" band. The alternation between stone-50 and this is what gives the page
 * its rhythm and keeps it from reading as one long white scroll. */
export function Stats() {
  return (
    <section className="bg-emerald-950 text-white">
      <div className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.value}>
              <p className="font-display text-3xl font-bold tracking-[-0.03em] text-emerald-300">{stat.value}</p>
              <p className="mt-2 text-sm leading-6 text-emerald-100/75">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
