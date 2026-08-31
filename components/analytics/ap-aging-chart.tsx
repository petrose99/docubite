import type { AgingBucketKey, ApAging } from "@/lib/analytics/workspace-analytics"
import Link from "next/link"

const AGED_BUCKET_KEYS: AgingBucketKey[] = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"]

const BUCKET_LABELS: Record<AgingBucketKey, string> = {
  current: "Current", d1_30: "1-30 days", d31_60: "31-60 days", d61_90: "61-90 days", d90_plus: "90+ days", no_due_date: "No due date",
}

const BUCKET_BAR: Record<AgingBucketKey, string> = {
  current: "bg-emerald-600", d1_30: "bg-amber-400", d31_60: "bg-amber-500", d61_90: "bg-orange-500", d90_plus: "bg-red-500", no_due_date: "bg-stone-300",
}

const BUCKET_BADGE: Record<AgingBucketKey, string> = {
  current: "bg-emerald-50 text-emerald-700", d1_30: "bg-amber-50 text-amber-700", d31_60: "bg-amber-100 text-amber-800",
  d61_90: "bg-orange-100 text-orange-800", d90_plus: "bg-red-100 text-red-700", no_due_date: "bg-stone-100 text-stone-600",
}

const OLDEST_UNPAID_LIMIT = 8

/** Accounts-payable aging: a bucketed meter per age band, then a list of the invoices actually
 * driving the total — the buckets alone say how much and how old, but nothing to act on. "No due
 * date" is always shown when non-empty and kept separate from the aged bands: it isn't overdue by
 * any measurable amount, it's a data gap this view is also meant to surface. */
export function ApAgingChart({ workspaceId, aging, formatMoney }: {
  workspaceId: string
  aging: ApAging
  formatMoney: (value: number) => string
}) {
  const { buckets, invoices, truncated } = aging
  const totalOutstanding = Object.values(buckets).reduce((sum, bucket) => sum + bucket.total, 0)
  const max = Math.max(...Object.values(buckets).map((bucket) => bucket.total), 1)
  const noDueDate = buckets.no_due_date

  return <section className="space-y-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-semibold text-stone-900">AP aging</h2>
      <span className="text-sm text-stone-500">Total outstanding: <span className="font-semibold text-stone-800">{formatMoney(totalOutstanding)}</span></span>
    </div>

    <div className="space-y-2">
      {AGED_BUCKET_KEYS.map((key) => {
        const bucket = buckets[key]
        const percent = bucket.total > 0 ? Math.max(Math.round((bucket.total / max) * 100), 2) : 0
        return <div key={key} className="space-y-1">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium text-stone-700">{BUCKET_LABELS[key]}</span>
            <span className="text-stone-500">{formatMoney(bucket.total)} · {bucket.count} invoice{bucket.count === 1 ? "" : "s"}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-stone-100">
            <div className={`h-full rounded-full ${BUCKET_BAR[key]}`} style={{ width: `${percent}%` }} />
          </div>
        </div>
      })}
      {noDueDate.count > 0 && <div className="space-y-1 border-t pt-2">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium text-stone-500">{BUCKET_LABELS.no_due_date}</span>
          <span className="text-stone-500">{formatMoney(noDueDate.total)} · {noDueDate.count} invoice{noDueDate.count === 1 ? "" : "s"}</span>
        </div>
      </div>}
    </div>

    <div className="space-y-1">
      <h3 className="text-sm font-semibold text-stone-700">Oldest unpaid</h3>
      {invoices.length === 0
        ? <p className="text-sm text-stone-500">No unpaid invoices.</p>
        : <ul className="divide-y rounded border">
          {invoices.slice(0, OLDEST_UNPAID_LIMIT).map((invoice) => <li key={invoice.documentId}>
            <Link href={`/workspaces/${workspaceId}/documents/${invoice.documentId}`}
              className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-stone-50">
              <span className="min-w-0 flex-1 truncate font-medium text-stone-800">{invoice.vendor || invoice.filename}</span>
              <span className="shrink-0 text-stone-500">{formatMoney(invoice.total)}</span>
              <span className="shrink-0 text-xs text-stone-400">{invoice.dueDate ? invoice.dueDate.toLocaleDateString() : "No due date"}</span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${BUCKET_BADGE[invoice.bucket]}`}>{BUCKET_LABELS[invoice.bucket]}</span>
            </Link>
          </li>)}
        </ul>}
      {truncated && <p className="text-xs text-stone-500">Showing the first 500 unpaid invoices.</p>}
    </div>
  </section>
}
