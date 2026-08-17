import { AlertTriangle, FileText, Plus, Sparkles, Table2 } from "lucide-react"

type Row = { n: number; supplier: string; invoice: string; date: string; tax: string; total: string; flagTax?: boolean }

const rows: Row[] = [
  { n: 2, supplier: "Northstar Ltd", invoice: "NS-0481", date: "12 Aug", tax: "473.33", total: "2,840.00" },
  { n: 3, supplier: "Atlas Supplies", invoice: "AT-1190", date: "09 Aug", tax: "188.00", total: "1,128.00" },
  { n: 4, supplier: "Meridian Print", invoice: "MP-3321", date: "07 Aug", tax: "102.50", total: "615.00", flagTax: true },
  { n: 5, supplier: "Cedar & Co", invoice: "CC-0067", date: "03 Aug", tax: "236.00", total: "1,416.00" },
  { n: 6, supplier: "Blue Harbour", invoice: "BH-8842", date: "01 Aug", tax: "412.00", total: "2,472.00" },
]

/** The hero's product mock: the live spreadsheet DocuBite hands back — a formula bar with an
 * =AI() cell, the AI assistant reading the grid, and rows extracted from the documents with an
 * uncertain value flagged for review. Every part is static markup so this stays a server
 * component and ships no JavaScript above the fold. */
export function ExtractionDemo() {
  return (
    <div className="relative">
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
            <span className="ml-auto inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1 text-[0.7rem] font-semibold text-white">
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
              <div className="max-w-[96%] self-end rounded-lg rounded-br-sm bg-emerald-700 px-2 py-1.5 text-[0.62rem] leading-snug text-white">Total tax across all invoices?</div>
              <div className="text-[0.62rem] leading-snug text-stone-700">
                The tax totals <b className="text-emerald-800">$1,411.83</b> across 5 invoices.
                <span className="mt-1.5 inline-flex items-center rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-mono text-[0.55rem] font-bold text-emerald-800">E2:E6</span>
              </div>
              <div className="mt-auto flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-[0.6rem] text-stone-400">Ask anything…<span className="h-2.5 w-px bg-emerald-600" /></div>
            </div>

            {/* grid */}
            <div className="overflow-hidden">
              <table className="w-full border-collapse text-[0.62rem]">
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
                          <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1 py-0.5 tabular-nums text-amber-800"><AlertTriangle className="h-2.5 w-2.5 text-amber-600" />{row.tax}</span>
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
      <div className="mt-3 inline-flex items-center gap-2 rounded-xl rounded-tr-sm bg-emerald-950 px-3 py-2 text-[0.7rem] text-emerald-100 sm:absolute sm:right-4 sm:top-full sm:mt-3.5 sm:shadow-[0_20px_40px_-18px_rgba(2,44,34,.8)]">
        <FileText className="h-3.5 w-3.5 text-emerald-400" />Click a cell → its spot on the PDF
      </div>
    </div>
  )
}
