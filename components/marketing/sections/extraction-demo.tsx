import { Check, FileText } from "lucide-react"

/** The hero's document-side mock — one invoice as its own sheet: a single file read into its
 * line-item rows (item, quantity, unit price, amount) with a total. Sits alongside DictationDemo
 * (the voice-side mock) so the hero shows both intake paths at a glance, not just documents.
 *
 * Rows land one after another as if being extracted, on a shared 7s CSS timeline. Pure CSS, so
 * this stays a server component, and it freezes into the finished grid under
 * prefers-reduced-motion. */
export function ExtractionDemo() {
  return (
    <div className="hero-demo relative">
      <style>{DEMO_KEYFRAMES}</style>

      <div className="rounded-[1.4rem] rounded-tr-md border border-stone-200 bg-white p-2.5 shadow-[0_30px_70px_-48px_rgba(41,37,36,.55)]">
        <div className="overflow-hidden rounded-[1rem] rounded-tr-sm border border-stone-200 bg-white">
          <div className="flex items-center gap-2.5 border-b border-stone-100 bg-stone-50 px-3 py-2">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-stone-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-stone-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-stone-200" />
            </div>
            <span className="inline-flex items-center gap-1.5 text-[0.74rem] font-semibold text-stone-700">
              <FileText className="h-3.5 w-3.5 text-emerald-700" />northstar-invoice.pdf
            </span>
            <span className="ml-auto inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[0.62rem] font-bold text-emerald-700">
              <Check className="h-2.5 w-2.5" />Extracted
            </span>
          </div>
          <table className="demo-ligrid w-full border-collapse text-[0.62rem]">
            <thead>
              <tr className="bg-stone-50 text-left font-semibold text-stone-500">
                <th className="border-b border-stone-100 px-1.5 py-1.5 font-semibold">Item</th>
                <th className="border-b border-stone-100 px-1.5 py-1.5 text-right font-semibold">Qty</th>
                <th className="border-b border-stone-100 px-1.5 py-1.5 text-right font-semibold">Unit</th>
                <th className="border-b border-stone-100 px-1.5 py-1.5 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="text-stone-900">
              <tr>
                <td className="whitespace-nowrap border-b border-stone-100 px-1.5 py-1.5 font-medium">Design retainer</td>
                <td className="border-b border-stone-100 px-1.5 py-1.5 text-right tabular-nums text-stone-500">1</td>
                <td className="border-b border-stone-100 px-1.5 py-1.5 text-right tabular-nums text-stone-500">1,200.00</td>
                <td className="border-b border-stone-100 px-1.5 py-1.5 text-right font-semibold tabular-nums">1,200.00</td>
              </tr>
              <tr>
                <td className="whitespace-nowrap border-b border-stone-100 px-1.5 py-1.5 font-medium">Print run</td>
                <td className="border-b border-stone-100 px-1.5 py-1.5 text-right tabular-nums text-stone-500">500</td>
                <td className="border-b border-stone-100 px-1.5 py-1.5 text-right tabular-nums text-stone-500">1.60</td>
                <td className="border-b border-stone-100 px-1.5 py-1.5 text-right font-semibold tabular-nums">800.00</td>
              </tr>
              <tr>
                <td className="whitespace-nowrap border-b border-stone-100 px-1.5 py-1.5 font-medium">Delivery</td>
                <td className="border-b border-stone-100 px-1.5 py-1.5 text-right tabular-nums text-stone-500">1</td>
                <td className="border-b border-stone-100 px-1.5 py-1.5 text-right tabular-nums text-stone-500">366.67</td>
                <td className="border-b border-stone-100 px-1.5 py-1.5 text-right font-semibold tabular-nums">366.67</td>
              </tr>
              <tr>
                <td className="px-1.5 py-1.5 text-right font-semibold text-stone-500" colSpan={3}>Total</td>
                <td className="px-1.5 py-1.5 text-right font-bold tabular-nums text-stone-900">2,840.00</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* source-trace chip */}
      <div className="demo-source inline-flex items-center gap-2 self-start rounded-xl rounded-tr-sm bg-emerald-950 px-3 py-2 text-[0.7rem] text-emerald-100 sm:absolute sm:right-4 sm:top-full sm:mt-3.5 sm:shadow-[0_20px_40px_-18px_rgba(2,44,34,.8)]">
        <FileText className="h-3.5 w-3.5 text-emerald-400" />Click a cell → its spot on the PDF
      </div>
    </div>
  )
}

const DEMO_KEYFRAMES = `
.hero-demo .demo-ligrid tbody tr:nth-child(1) { animation: demoRow1 7s ease-in-out infinite; }
.hero-demo .demo-ligrid tbody tr:nth-child(2) { animation: demoRow2 7s ease-in-out infinite; }
.hero-demo .demo-ligrid tbody tr:nth-child(3) { animation: demoRow3 7s ease-in-out infinite; }
.hero-demo .demo-ligrid tbody tr:nth-child(4) { animation: demoRow4 7s ease-in-out infinite; }
.hero-demo .demo-source { animation: demoGlow 7s ease-in-out infinite; }

@keyframes demoRow1 {
  0%, 10% { opacity: 0; transform: translateY(8px); }
  17%, 88% { opacity: 1; transform: translateY(0); }
  95%, 100% { opacity: 0; }
}
@keyframes demoRow2 {
  0%, 16% { opacity: 0; transform: translateY(8px); }
  23%, 88% { opacity: 1; transform: translateY(0); }
  95%, 100% { opacity: 0; }
}
@keyframes demoRow3 {
  0%, 22% { opacity: 0; transform: translateY(8px); }
  29%, 88% { opacity: 1; transform: translateY(0); }
  95%, 100% { opacity: 0; }
}
@keyframes demoRow4 {
  0%, 28% { opacity: 0; transform: translateY(8px); }
  35%, 88% { opacity: 1; transform: translateY(0); }
  95%, 100% { opacity: 0; }
}
@keyframes demoGlow {
  0%, 66% { box-shadow: 0 20px 40px -18px rgba(2,44,34,.8), 0 0 0 0 rgba(52,211,153,0); }
  76% { box-shadow: 0 20px 40px -18px rgba(2,44,34,.8), 0 0 0 3px rgba(52,211,153,.35); }
  86%, 100% { box-shadow: 0 20px 40px -18px rgba(2,44,34,.8), 0 0 0 0 rgba(52,211,153,0); }
}
@media (prefers-reduced-motion: reduce) {
  .hero-demo .demo-ligrid tbody tr,
  .hero-demo .demo-source { animation: none; opacity: 1; transform: none; }
}
`
