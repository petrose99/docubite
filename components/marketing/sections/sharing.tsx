import { Link2, Share2 } from "lucide-react"

const levels = [
  { label: "View", note: "read only", selected: false },
  { label: "Interact", note: "live grid, edits never saved", selected: true },
  { label: "Edit", note: "full access", selected: false },
  { label: "Off", note: "", selected: false },
]

/** The sharing story, kept compact: the differentiator is the "interact" level — a live sandbox
 * grid the recipient can total and formula over where nothing is ever saved, and where =AI() is
 * switched off so a visitor can't spend the owner's credits. Split-section mirrors provenance.tsx;
 * the mock is the actual share dialog's four levels. */
export function Sharing() {
  return (
    <section className="border-t border-stone-200 bg-white">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-20 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Sharing</p>
          <h2 className="mt-3 font-display text-3xl font-bold leading-[1.1] tracking-[-0.03em] text-stone-950 sm:text-4xl">
            Send the sheet, not a screenshot of it.
          </h2>
          <p className="mt-5 max-w-lg text-lg leading-7 text-stone-600">
            A file shares by public link or per email address, and the person on the other end doesn&apos;t need an account. Three levels: view it, interact with it, or edit it — and &ldquo;interact&rdquo; is the interesting one: a live grid they can total, formula over and poke at, where nothing they do is ever saved. A sandbox, not a liability.
          </p>
          <p className="mt-5 max-w-lg text-sm leading-6 text-stone-500">
            <span className="font-mono">=AI()</span> is switched off on shared links. Visitors explore your data; they don&apos;t spend your credits.
          </p>
        </div>

        <div className="overflow-hidden rounded-[1.4rem] rounded-tr-md border border-stone-200 bg-white shadow-[0_40px_80px_-50px_rgba(41,37,36,.5)]">
          <div className="flex items-center gap-2 border-b border-stone-100 px-3.5 py-2.5">
            <Share2 className="h-3.5 w-3.5 text-stone-400" />
            <span className="text-sm font-semibold text-stone-800">Share · Q1 utilities</span>
          </div>
          <div className="flex items-center gap-2 border-b border-stone-100 bg-stone-50 px-3.5 py-2.5">
            <Link2 className="h-3.5 w-3.5 shrink-0 text-stone-400" />
            <span className="truncate font-mono text-xs text-stone-500">docubite.app/s/q1-utilities-8f2a</span>
            <span className="ml-auto shrink-0 rounded-md border border-stone-200 bg-white px-2 py-1 text-xs font-semibold text-stone-600">Copy</span>
          </div>
          <div className="divide-y divide-stone-100 p-2">
            {levels.map((level) => (
              <div
                key={level.label}
                className={`flex items-center gap-3 rounded-lg px-2.5 py-2.5 ${level.selected ? "bg-emerald-50" : ""}`}>
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${level.selected ? "border-emerald-600" : "border-stone-300"}`}>
                  {level.selected && <span className="h-2 w-2 rounded-full bg-emerald-600" />}
                </span>
                <span className={`text-sm font-semibold ${level.selected ? "text-emerald-900" : "text-stone-800"}`}>{level.label}</span>
                {level.note && <span className={`text-xs ${level.selected ? "text-emerald-700" : "text-stone-500"}`}>— {level.note}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
