import { AlertTriangle, Check, FileText, Plus, Sparkles, Table2 } from "lucide-react"

type Row = { n: number; supplier: string; invoice: string; date: string; tax: string; total: string; flagTax?: boolean }

const rows: Row[] = [
  { n: 2, supplier: "Northstar Ltd", invoice: "NS-0481", date: "12 Aug", tax: "473.33", total: "2,840.00" },
  { n: 3, supplier: "Atlas Supplies", invoice: "AT-1190", date: "09 Aug", tax: "188.00", total: "1,128.00" },
  { n: 4, supplier: "Meridian Print", invoice: "MP-3321", date: "07 Aug", tax: "102.50", total: "615.00", flagTax: true },
  { n: 5, supplier: "Cedar & Co", invoice: "CC-0067", date: "03 Aug", tax: "236.00", total: "1,416.00" },
  { n: 6, supplier: "Blue Harbour", invoice: "BH-8842", date: "01 Aug", tax: "412.00", total: "2,472.00" },
]

/** The hero's product mock, in two panes — the "one file or a folder of a hundred" line made
 * literal:
 *
 * - The top pane is a single invoice as its own sheet: one document read into its line-item
 *   rows — item, quantity, unit price, amount — with a total. This is what one file looks like
 *   coming out.
 * - The bottom pane is the folder: a sheet with the whole month's invoices as rows, an =AI()
 *   formula in the bar, the assistant reading the grid, and the low-confidence tax cell flagged
 *   for review.
 *
 * Both panes play themselves — their rows land one after another as if being extracted, and in
 * the folder the flag pops and the assistant answers — on one shared 7s CSS timeline. It is all
 * pure CSS, so this stays a server component that ships nothing above the fold, and it freezes
 * into the finished grids under prefers-reduced-motion. */
export function ExtractionDemo() {
  return (
    <div className="hero-demo relative flex flex-col gap-4">
      <style>{DEMO_KEYFRAMES}</style>

      {/* Pane one — a single invoice, its own sheet. */}
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

      {/* Pane two — the whole folder, in the live grid. */}
      <div className="rounded-[1.6rem] rounded-tr-md border border-stone-200 bg-white p-3 shadow-[0_40px_90px_-50px_rgba(41,37,36,.55)]">
        <div className="overflow-hidden rounded-[1.1rem] rounded-tr-sm border border-stone-200 bg-white">
          {/* window chrome */}
          <div className="flex items-center gap-2.5 border-b border-stone-100 bg-stone-50 px-3.5 py-2.5">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-stone-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-stone-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-stone-200" />
            </div>
            <span className="inline-flex items-center gap-1.5 text-[0.78rem] font-semibold text-stone-700">
              <Table2 className="h-3.5 w-3.5 text-emerald-700" />August invoices
            </span>
            <span className="demo-extract ml-auto inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1 text-[0.7rem] font-semibold text-white">
              <Plus className="h-3 w-3" />Extract
            </span>
          </div>

          {/* formula bar */}
          <div className="flex items-center gap-2 overflow-hidden border-b border-stone-100 px-3 py-1.5">
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[0.7rem] font-semibold text-emerald-800"><Sparkles className="h-3 w-3" />Ask AI</span>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-[0.7rem] font-semibold text-stone-600"><Sparkles className="h-3 w-3 text-emerald-600" />AI Formula</span>
            <span className="truncate font-mono text-[0.7rem] text-stone-900"><span className="text-emerald-600">=AI(</span>&quot;Which category?&quot;, A2:F2<span className="text-emerald-600">)</span></span>
          </div>

          {/* assistant + grid */}
          <div className="grid grid-cols-[6.75rem_minmax(0,1fr)] sm:grid-cols-[7.75rem_minmax(0,1fr)]">
            {/* assistant */}
            <div className="flex min-h-[14rem] flex-col gap-2 border-r border-stone-100 bg-stone-50 px-2 py-2.5">
              <div className="flex items-center gap-1.5 text-[0.68rem] font-bold text-stone-800"><Sparkles className="h-3 w-3 text-emerald-700" />Assistant</div>
              <div className="demo-ask max-w-[96%] self-end rounded-lg rounded-br-sm bg-emerald-700 px-2 py-1.5 text-[0.62rem] leading-snug text-white">Total tax across all invoices?</div>
              <div className="demo-answer text-[0.62rem] leading-snug text-stone-700">
                The tax totals <b className="text-emerald-800">$1,411.83</b> across 5 invoices.
                <span className="mt-1.5 inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-mono text-[0.55rem] font-bold text-emerald-800">E2:E6</span>
              </div>
              <div className="mt-auto flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-[0.6rem] text-stone-400">Ask anything…<span className="demo-caret h-2.5 w-px bg-emerald-600" /></div>
            </div>

            {/* grid */}
            <div className="overflow-hidden">
              <table className="demo-grid w-full border-collapse text-[0.62rem]">
                <thead>
                  <tr className="bg-stone-50 text-left font-semibold text-stone-500">
                    <th className="w-4 border-b border-r border-stone-100 px-1 py-1.5 text-center font-semibold text-stone-300">#</th>
                    <th className="border-b border-stone-100 px-1.5 py-1.5 font-semibold">Supplier</th>
                    <th className="border-b border-stone-100 px-1.5 py-1.5 font-semibold">Invoice&nbsp;#</th>
                    <th className="border-b border-stone-100 px-1.5 py-1.5 font-semibold">Date</th>
                    <th className="border-b border-stone-100 px-1.5 py-1.5 text-right font-semibold">Tax</th>
                    <th className="border-b border-stone-100 px-1.5 py-1.5 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="text-stone-900">
                  {rows.map((row) => (
                    <tr key={row.n}>
                      <td className="border-b border-r border-stone-100 px-1 py-1.5 text-center text-stone-300">{row.n}</td>
                      <td className="whitespace-nowrap border-b border-stone-100 px-1.5 py-1.5 font-semibold">{row.supplier}</td>
                      <td className="border-b border-stone-100 px-1.5 py-1.5 text-stone-500">{row.invoice}</td>
                      <td className="whitespace-nowrap border-b border-stone-100 px-1.5 py-1.5 text-stone-500">{row.date}</td>
                      <td className="border-b border-stone-100 px-1.5 py-1.5 text-right tabular-nums">
                        {row.flagTax ? (
                          <span className="demo-flag inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1 py-0.5 tabular-nums text-amber-800"><AlertTriangle className="h-2.5 w-2.5 text-amber-600" />{row.tax}</span>
                        ) : row.tax}
                      </td>
                      <td className="border-b border-stone-100 px-1.5 py-1.5 text-right font-semibold tabular-nums">{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* source-trace chip */}
      <div className="demo-source inline-flex items-center gap-2 self-start rounded-xl rounded-tr-sm bg-emerald-950 px-3 py-2 text-[0.7rem] text-emerald-100 sm:absolute sm:right-4 sm:top-full sm:mt-3.5 sm:shadow-[0_20px_40px_-18px_rgba(2,44,34,.8)]">
        <FileText className="h-3.5 w-3.5 text-emerald-400" />Click a cell → its spot on the PDF
      </div>
    </div>
  )
}

/** The folder pane plays itself on one shared 7s clock: rows cascade in (staggered by keyframe,
 * not per-element delay, so they clear together and the loop restarts clean), the tax cell flags,
 * the assistant answers, the source chip glows, then it holds and resets. The Extract pulse and
 * the input caret run on their own short ambient loops. Under reduced-motion everything snaps to
 * the finished grid. The single-invoice pane above is static — it is a fact, not a performance. */
const DEMO_KEYFRAMES = `
.hero-demo .demo-ligrid tbody tr:nth-child(1) { animation: demoRow1 7s ease-in-out infinite; }
.hero-demo .demo-ligrid tbody tr:nth-child(2) { animation: demoRow2 7s ease-in-out infinite; }
.hero-demo .demo-ligrid tbody tr:nth-child(3) { animation: demoRow3 7s ease-in-out infinite; }
.hero-demo .demo-ligrid tbody tr:nth-child(4) { animation: demoRow4 7s ease-in-out infinite; }
.hero-demo .demo-grid tbody tr:nth-child(1) { animation: demoRow1 7s ease-in-out infinite; }
.hero-demo .demo-grid tbody tr:nth-child(2) { animation: demoRow2 7s ease-in-out infinite; }
.hero-demo .demo-grid tbody tr:nth-child(3) { animation: demoRow3 7s ease-in-out infinite; }
.hero-demo .demo-grid tbody tr:nth-child(4) { animation: demoRow4 7s ease-in-out infinite; }
.hero-demo .demo-grid tbody tr:nth-child(5) { animation: demoRow5 7s ease-in-out infinite; }
.hero-demo .demo-flag { animation: demoFlag 7s ease-in-out infinite; }
.hero-demo .demo-ask { animation: demoAsk 7s ease-in-out infinite; }
.hero-demo .demo-answer { animation: demoAnswer 7s ease-in-out infinite; }
.hero-demo .demo-source { animation: demoGlow 7s ease-in-out infinite; }
.hero-demo .demo-extract { animation: demoPulse 2.33s ease-in-out infinite; }
.hero-demo .demo-caret { animation: demoBlink 1.1s steps(1) infinite; }

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
@keyframes demoRow5 {
  0%, 34% { opacity: 0; transform: translateY(8px); }
  41%, 88% { opacity: 1; transform: translateY(0); }
  95%, 100% { opacity: 0; }
}
@keyframes demoFlag {
  0%, 44% { opacity: 0; transform: scale(.7); }
  50% { opacity: 1; transform: scale(1.14); }
  55% { transform: scale(1); }
  88% { opacity: 1; }
  95%, 100% { opacity: 0; }
}
@keyframes demoAsk {
  0%, 40% { opacity: 0; transform: translateY(5px); }
  47%, 88% { opacity: 1; transform: translateY(0); }
  95%, 100% { opacity: 0; }
}
@keyframes demoAnswer {
  0%, 54% { opacity: 0; transform: translateY(5px); }
  61%, 88% { opacity: 1; transform: translateY(0); }
  95%, 100% { opacity: 0; }
}
@keyframes demoGlow {
  0%, 66% { box-shadow: 0 20px 40px -18px rgba(2,44,34,.8), 0 0 0 0 rgba(52,211,153,0); }
  76% { box-shadow: 0 20px 40px -18px rgba(2,44,34,.8), 0 0 0 3px rgba(52,211,153,.35); }
  86%, 100% { box-shadow: 0 20px 40px -18px rgba(2,44,34,.8), 0 0 0 0 rgba(52,211,153,0); }
}
@keyframes demoPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}
@keyframes demoBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .hero-demo .demo-ligrid tbody tr,
  .hero-demo .demo-grid tbody tr,
  .hero-demo .demo-flag,
  .hero-demo .demo-ask,
  .hero-demo .demo-answer,
  .hero-demo .demo-source,
  .hero-demo .demo-extract,
  .hero-demo .demo-caret { animation: none; opacity: 1; transform: none; }
}
`
