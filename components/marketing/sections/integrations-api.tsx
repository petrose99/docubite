import { Check, FileSpreadsheet, Webhook } from "lucide-react"

const points = [
  "Push reviewed invoices and receipts straight to QuickBooks or Xero, one click per document",
  "A public REST API and signed webhooks — 6 event types, automatic redelivery, workspace-scoped API keys",
  "Export your own columns and formulas to XLSX or CSV whenever you need the file, not the feed",
]

/** Backend audit found real, shipped integrations the marketing site never mentioned — this is
 * Dext's whole pitch ("syncs to your accounting software") and DocuBite already has it. */
export function IntegrationsApi() {
  return (
    <section id="integrations" className="bg-cream-100">
      <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-20 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-emerald-700">Integrations &amp; API</p>
          <h2 className="mt-3 font-display text-3xl font-bold leading-[1.08] tracking-[-0.03em] text-stone-950 sm:text-4xl">
            Plays well with the <span className="text-emerald-600">rest of your stack.</span>
          </h2>
          <p className="mt-5 max-w-lg text-lg leading-7 text-stone-600">
            The sheet doesn&apos;t have to be the last stop. Push a reviewed document on to the ledger you already use, or wire DocuBite into whatever else runs your workflow — a webhook fires the moment a document is ready.
          </p>
          <ul className="mt-6 space-y-3">
            {points.map((point) => (
              <li key={point} className="flex gap-2.5 text-[0.95rem] leading-6 text-stone-800">
                <Check aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />{point}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-[1.4rem] rounded-tr-md border border-cream-200 bg-white p-5 shadow-[0_30px_70px_-48px_rgba(41,37,36,.55)]">
            <p className="text-xs font-bold uppercase tracking-[.1em] text-stone-400">Push to accounting</p>
            <div className="mt-3 flex flex-wrap gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm font-semibold text-stone-700">QuickBooks</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm font-semibold text-stone-700">Xero</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cream-200 bg-cream-50 px-3 py-1.5 text-sm font-semibold text-stone-700"><FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />XLSX / CSV</span>
            </div>
          </div>

          <div className="overflow-hidden rounded-[1.4rem] rounded-tr-md border border-stone-800 bg-stone-950 shadow-[0_30px_70px_-48px_rgba(41,37,36,.55)]">
            <div className="flex items-center gap-2 border-b border-stone-800 px-3.5 py-2.5">
              <Webhook className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-sm font-semibold text-stone-100">POST /webhooks/receiver</span>
            </div>
            <pre className="overflow-x-auto px-3.5 py-3 text-[0.72rem] leading-6 text-emerald-300">
{`{
  "type": "document.reviewed",
  "workspace_id": "ws_8f2a",
  "data": {
    "document": {
      "filename": "acme-feb.pdf",
      "status": "reviewed",
      "total": 615.00
    }
  }
}`}
            </pre>
          </div>
        </div>
      </div>
    </section>
  )
}
