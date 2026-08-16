import { Check, FileText } from "lucide-react"

const fields = [
  { label: "Supplier", value: "Northstar Ltd" },
  { label: "Invoice number", value: "NS-0481" },
  { label: "Invoice date", value: "12 Aug 2026" },
  { label: "Tax (20%)", value: "473.33" },
  { label: "Total", value: "2,840.00 USD" },
]

/** The hero's product mock: a page being read on the left, fields landing in a sheet on the
 * right. Every moving part is CSS (see .doc-scan / .field-reveal in globals.css), so this stays
 * a server component and ships no JavaScript. */
export function ExtractionDemo() {
  return (
    <div className="rounded-[2rem] rounded-tr-md border border-stone-200 bg-white p-3 shadow-[0_32px_90px_-48px_rgba(41,37,36,.55)]">
      <div className="rounded-[1.6rem] rounded-tr-sm bg-stone-950 p-4">
        <div className="flex items-center justify-between px-1 pb-3 text-xs text-stone-400">
          <span className="inline-flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" />invoice-0481.pdf</span>
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-300">Invoice template</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-[0.85fr_1fr]">
          {/* The page. Its "text" is bars rather than lorem ipsum — a real-looking document at
              this size would only be an unreadable smudge that begs to be squinted at. */}
          <div className="doc-scan relative overflow-hidden rounded-xl bg-white p-3.5">
            <div className="h-2 w-2/5 rounded-full bg-stone-800" />
            <div className="mt-1.5 h-1.5 w-1/4 rounded-full bg-stone-300" />
            <div className="mt-4 space-y-1.5">
              {[80, 62, 74, 55, 68, 45].map((width, index) => (
                <div key={index} className="h-1.5 rounded-full bg-stone-200" style={{ width: `${width}%` }} />
              ))}
            </div>
            <div className="mt-4 h-px bg-stone-200" />
            <div className="mt-3 flex items-center justify-between">
              <div className="h-1.5 w-1/4 rounded-full bg-stone-200" />
              <div className="h-2 w-1/3 rounded-full bg-emerald-600/70" />
            </div>
          </div>

          {/* The sheet. */}
          <div className="rounded-xl bg-white p-1.5">
            <table className="w-full border-collapse text-left">
              <tbody>
                {fields.map((field, index) => (
                  <tr key={field.label} className="field-reveal border-b border-stone-100 last:border-0" style={{ animationDelay: `${0.5 + index * 0.55}s` }}>
                    <th scope="row" className="whitespace-nowrap px-2 py-[0.55rem] text-[0.7rem] font-medium text-stone-400">{field.label}</th>
                    <td className="px-2 py-[0.55rem] text-right text-[0.78rem] font-semibold tabular-nums text-stone-900">{field.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="field-reveal flex items-center justify-center gap-1.5 pb-1.5 pt-2 text-[0.7rem] font-medium text-emerald-700" style={{ animationDelay: "3.3s" }}>
              <Check className="h-3.5 w-3.5" />Ready for review
            </p>
          </div>
        </div>
      </div>
      <p className="px-3 pb-1 pt-3.5 text-center text-sm text-stone-500">One bite: source page in, reviewed fields out.</p>
    </div>
  )
}
