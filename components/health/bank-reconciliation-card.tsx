/** The "bank_reconciliation" check's dedicated Dext-style dashboard — check-detail.tsx's third
 * special case, alongside the generic FindingCard list (every non-activity check) and
 * ActivityStatCard (Phase D's activity checks). Fed by models/health.ts's
 * getBankReconciliationSummary rather than the finding rows every other check renders: this check
 * produces one finding per stale statement (for the score + a fallback FindingCard view), but the
 * dashboard itself is a live read of every bank statement document's current match state, not a
 * list of findings.
 *
 * Visual language reused verbatim from the rest of components/health/*: rounded-xl/rounded-lg
 * white cards, slate-500 labels, bold slate-900 numbers, emerald accents for links/positive
 * figures — same palette as activity-stat-card.tsx and health-score-card.tsx, no new colors. */
import type { BankReconciliationSummary } from "@/models/health"
import Link from "next/link"

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(date: Date | null): string {
  if (!date) return "—"
  return new Date(date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function StatRow({ label, value, valueClassName = "text-slate-900" }: { label: string; value: string; valueClassName?: string }) {
  return <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
    <span className="text-slate-500">{label}</span>
    <span className={`font-semibold tabular-nums ${valueClassName}`}>{value}</span>
  </div>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border bg-white p-4 shadow-sm">
    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">{title}</h3>
    <div className="mt-2 divide-y divide-slate-100">{children}</div>
  </div>
}

export function BankReconciliationCard({ workspaceId, summary }: { workspaceId: string; summary: BankReconciliationSummary }) {
  if (summary.statementCount === 0) {
    return <p className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-slate-500">
      No bank statements uploaded yet. Upload one with the Bank statement template to see reconciliation status here.
    </p>
  }

  return <div className="space-y-4">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Section title="Financial position">
        <StatRow label="Money in" value={formatCurrency(summary.totalIn)} valueClassName="text-emerald-700" />
        <StatRow label="Money out" value={formatCurrency(summary.totalOut)} valueClassName="text-slate-900" />
      </Section>

      <Section title="Statement status">
        <StatRow label="Statements" value={String(summary.statementCount)} />
        <StatRow label="Most recent" value={formatDate(summary.mostRecentReceivedAt)} />
      </Section>

      <Section title="Reconciliation status">
        <StatRow label="Total transactions" value={String(summary.totalTransactions)} />
        <StatRow label="Matched" value={String(summary.matchedTransactions)} valueClassName="text-emerald-700" />
        <StatRow label="Unmatched" value={String(summary.unmatchedTransactions)} valueClassName={summary.unmatchedTransactions > 0 ? "text-amber-600" : "text-slate-900"} />
      </Section>
    </div>

    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Bank statements</h3>
      <div className="mt-2 space-y-2">
        {summary.statements.map((statement) => <Link key={statement.documentId} href={`/workspaces/${workspaceId}/documents/${statement.documentId}`}
          className="flex items-center justify-between gap-4 rounded-lg border border-transparent px-2 py-2 text-sm hover:border-slate-200 hover:bg-slate-50">
          <span className="min-w-0 truncate font-medium text-emerald-700 hover:underline">{statement.filename}</span>
          <span className="shrink-0 text-xs text-slate-500">
            {statement.transactionCount} txns · <span className="text-emerald-700">{statement.matchedCount} matched</span>
            {statement.unmatchedCount > 0 && <> · <span className="text-amber-600">{statement.unmatchedCount} unmatched</span></>}
          </span>
        </Link>)}
      </div>
    </div>
  </div>
}
