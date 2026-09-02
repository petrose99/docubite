import { ActivityStatCard } from "@/components/health/activity-stat-card"
import { BankReconciliationCard } from "@/components/health/bank-reconciliation-card"
import { FindingCard, type HealthFindingRow } from "@/components/health/finding-card"
import type { CheckDefinition } from "@/lib/health/types"
import type { BankReconciliationSummary } from "@/models/health"

/** The focused per-check view Data Health's sidebar nav (health-sidebar-nav.tsx) links to —
 * replacing category-tabs.tsx's old flat "every finding in this category" list with a dedicated
 * pane for exactly one check, matching Dext's reference screenshot ("Bank reconciliation" selected
 * shows only that check's own detail, not every Cleanup finding). `findings` is already scoped to
 * `check.code` by the caller (models/health.ts's listHealthFindings filters.checkCode) — this
 * component does no further filtering.
 *
 * Phase D's activity checks (defaultWeight 0, informational, never scored — see lib/health/
 * score.ts) render as one full-size ActivityStatCard instead of FindingCard's severity-badged
 * rows: there's nothing to dismiss or remediate about "132 documents this month", same reasoning
 * category-tabs.tsx used for its Activity tab. The "bank_reconciliation" check (category
 * "cleanup", not "activity") is a third special case: it gets its own real dashboard
 * (BankReconciliationCard) fed by models/health.ts's getBankReconciliationSummary rather than the
 * check's findings — a per-statement live match-state view, not a list of things to dismiss.
 * Every other check renders FindingCard rows, unchanged from Phase A-C — dismiss and the two-step
 * remediation dry-run/confirm flow both keep working exactly as before, since FindingCard itself
 * is untouched. */
export function CheckDetail({ workspaceId, check, findings, canRemediate = false, hasLedgerConnection = false, bankReconciliationSummary = null }: {
  workspaceId: string
  check: CheckDefinition
  findings: HealthFindingRow[]
  canRemediate?: boolean
  /** Phase D: whether this workspace has an active IntegrationConnection — reconciliation_rate is
   * the one activity check that declares requiresLedger: true and simply never produces a finding
   * without one, so its empty state needs to explain that gap rather than just saying "nothing
   * found". See lib/health/checks/reconciliation-rate.ts and category-tabs.tsx's old equivalent. */
  hasLedgerConnection?: boolean
  /** Only fetched (by app/.../health/page.tsx's CheckDetailSection) when check.code is
   * "bank_reconciliation" — null for every other check, in which case this component never enters
   * that branch. */
  bankReconciliationSummary?: BankReconciliationSummary | null
}) {
  const isBankReconciliation = check.code === "bank_reconciliation"
  const isActivity = check.category === "activity"

  return <section className="space-y-4">
    <header>
      <h2 className="text-xl font-bold text-slate-900">{check.name}</h2>
    </header>

    {isBankReconciliation
      ? <BankReconciliationCard workspaceId={workspaceId} summary={bankReconciliationSummary ?? { totalIn: 0, totalOut: 0, statementCount: 0, mostRecentReceivedAt: null, totalTransactions: 0, matchedTransactions: 0, unmatchedTransactions: 0, statements: [] }} />
      : isActivity
        ? findings[0]
          ? <div className="max-w-xs"><ActivityStatCard finding={findings[0]} /></div>
          : <p className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-slate-500">
              {check.requiresLedger && !hasLedgerConnection
                ? "Connect an accounting integration to see this metric."
                : "No data yet for this check."}
            </p>
        : findings.length === 0
          ? <p className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-slate-500">
              Nothing found for this check.
            </p>
          : <div className="space-y-3">
              {findings.map((finding) => <FindingCard key={finding.id} workspaceId={workspaceId} finding={finding} canRemediate={canRemediate} />)}
            </div>}
  </section>
}
