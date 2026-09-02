import { CategorySummaryChips } from "@/components/health/category-summary-chips"
import { CheckDetail } from "@/components/health/check-detail"
import type { HealthFindingRow } from "@/components/health/finding-card"
import { HealthScoreCard } from "@/components/health/health-score-card"
import { HealthSidebarNav } from "@/components/health/health-sidebar-nav"
import { RunChecksButton } from "@/components/health/run-checks-button"
import { SyncLedgerButton } from "@/components/health/sync-ledger-button"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { findCheck } from "@/lib/health/registry"
import { scoreBucket } from "@/lib/health/score"
import type { HealthCategory, HealthSeverity } from "@/lib/health/types"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { getBankReconciliationSummary, getHealthScoreHistory, getProjectedHealthScore, listHealthFindings } from "@/models/health"
import { requireWorkspaceRole } from "@/models/workspaces"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

function toRow(finding: Awaited<ReturnType<typeof listHealthFindings>>[number]): HealthFindingRow {
  return {
    id: finding.id,
    checkCode: finding.checkCode,
    category: finding.category as HealthCategory,
    severity: finding.severity as HealthSeverity,
    title: finding.title,
    description: finding.description,
    affectedCount: undefined,
    document: finding.document,
    suggestedAction: finding.suggestedAction,
    suggestedActionPayload: finding.suggestedActionPayload as Record<string, unknown> | null,
  }
}

/** Data Health's dashboard: a left sub-nav (health-sidebar-nav.tsx) grouped by category with one
 * link per registered check, plus Overview at the top, and a detail pane on the right driven by
 * the `?check=<code>` search param — mirrors how app/(app)/workspaces/[workspaceId]/pipeline/
 * page.tsx threads `?stage=` through searchParams into a plain server-rendered navigation, no
 * client-side tab state. Full-width — this lives directly under [workspaceId]/, not the (chrome)
 * route group's narrow settings column, matching review/pipeline.
 *
 * Fetch shape differs by view: Overview needs every open finding (to build the per-category
 * summary chips) plus the score history/projection; a single check's detail view needs only that
 * check's own findings, via listHealthFindings' checkCode filter (models/health.ts) rather than
 * fetching everything and filtering client-side. */
export default async function HealthPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ check?: string }>
}) {
  const { workspaceId } = await params
  const { check: checkParam } = await searchParams
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)
  // Phase C: only a workspace owner gets remediation buttons at all (health-actions.ts enforces
  // this server-side too, via requireWorkspaceRole(..., ["owner"]) — this is purely a UI gate so a
  // non-owner sees the finding without a button rather than a button that always fails).
  const canRemediate = membership.role === "owner"
  const capabilities = await getWorkspaceCapabilities(workspaceId)
  if (!capabilities.has("data-health")) notFound()

  const activeCheck = findCheck(checkParam)
  const activeConnection = await prisma.integrationConnection.findFirst({ where: { workspaceId, status: "active" }, select: { id: true }, orderBy: { createdAt: "asc" } })

  return <main className="mx-auto w-full max-w-6xl space-y-6 p-6">
    <header className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Data health</h1>
        <p className="mt-1 text-sm text-slate-500">Automated bookkeeping quality audits, linked back to the document that caused each one.</p>
      </div>
      <div className="flex items-center gap-2">
        {activeConnection && <SyncLedgerButton workspaceId={workspaceId} connectionId={activeConnection.id} />}
        <RunChecksButton workspaceId={workspaceId} />
      </div>
    </header>

    <div className="flex items-start gap-6">
      {/* Pure function of the registry + which check is selected — no fetch of its own, so
          picking one check doesn't pull every other check's findings just to badge the nav. */}
      <HealthSidebarNav workspaceId={workspaceId} activeCheck={activeCheck?.code ?? null} />

      <div className="min-w-0 flex-1">
        {activeCheck
          ? <CheckDetailSection workspaceId={workspaceId} checkCode={activeCheck.code} canRemediate={canRemediate} hasLedgerConnection={activeConnection !== null} />
          : <OverviewSection workspaceId={workspaceId} />}
      </div>
    </div>
  </main>
}

async function OverviewSection({ workspaceId }: { workspaceId: string }) {
  const [findings, history, projected] = await Promise.all([
    listHealthFindings(workspaceId, { status: "open" }),
    getHealthScoreHistory(workspaceId, 30),
    getProjectedHealthScore(workspaceId),
  ])

  const latest = history.at(-1) ?? null
  const score = latest?.score ?? null
  const bucket = score === null ? null : scoreBucket(score)

  const countsByCategory: Record<HealthCategory, number> = { pipeline: 0, cleanup: 0, tax: 0, activity: 0 }
  for (const finding of findings) countsByCategory[finding.category as HealthCategory]++

  return <div className="space-y-6">
    <HealthScoreCard score={score} bucket={bucket} history={history.map((point) => ({ computedOn: point.computedOn.toISOString(), score: point.score }))}
      projected={projected && { projectedScore: projected.projectedScore, pendingDocumentCount: projected.pendingDocumentCount, riskFactors: projected.riskFactors }} />
    <CategorySummaryChips countsByCategory={countsByCategory} />
  </div>
}

async function CheckDetailSection({ workspaceId, checkCode, canRemediate, hasLedgerConnection }: {
  workspaceId: string
  checkCode: string
  canRemediate: boolean
  hasLedgerConnection: boolean
}) {
  const check = findCheck(checkCode)
  if (!check) notFound()
  // "bank_reconciliation" gets its own live dashboard (BankReconciliationCard, via
  // getBankReconciliationSummary) alongside its findings — see check-detail.tsx's third branch.
  // Every other check only needs listHealthFindings, same as before.
  const [findings, bankReconciliationSummary] = await Promise.all([
    listHealthFindings(workspaceId, { status: "open", checkCode }),
    checkCode === "bank_reconciliation" ? getBankReconciliationSummary(workspaceId) : Promise.resolve(null),
  ])
  return <CheckDetail workspaceId={workspaceId} check={check} findings={findings.map(toRow)} canRemediate={canRemediate} hasLedgerConnection={hasLedgerConnection} bankReconciliationSummary={bankReconciliationSummary} />
}
