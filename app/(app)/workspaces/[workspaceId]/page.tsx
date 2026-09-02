import { ApAgingChart } from "@/components/analytics/ap-aging-chart"
import { CashFlowChart } from "@/components/analytics/cash-flow-chart"
import { PeriodFilter } from "@/components/analytics/period-filter"
import { HeadlineCards } from "@/components/analytics/stat-cards"
import { SpendByCategoryChart } from "@/components/analytics/spend-by-category-chart"
import type { SheetTemplate } from "@/components/extract/types"
import { FileHubUploadButton } from "@/components/files/file-hub-upload-button"
import { LastUpdated } from "@/components/shared/relative-time"
import config from "@/lib/config"
import { getCurrentUser } from "@/lib/auth"
import { getWorkspaceAnalytics, resolvePeriod } from "@/lib/analytics/workspace-analytics"
import { parseTemplateFields } from "@/lib/document-templates"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { countDocumentsByStage, countDocumentsThisMonth, countToReviewByFile, flaggedFieldsFromConfidence, listWorkspaceDocuments, summarizeDocumentForReview } from "@/models/documents"
import { ensurePipelineFile, getFileTemplates, listRecentFiles } from "@/models/files"
import { getWorkspaceUsage, requireWorkspaceRole } from "@/models/workspaces"
import { Archive, CheckCircle2, ChevronRight, FileText, SearchCheck, Table2 } from "lucide-react"
import Link from "next/link"

export const dynamic = "force-dynamic"

function formatMoney(value: number, currency: string | null): string {
  const rounded = Math.round(value)
  if (currency) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(rounded)
    } catch {
      // A currency code extracted from a document (or a legacy tax-profile region) that Intl
      // doesn't recognise falls back to a plain number rather than throwing the whole page.
    }
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(rounded)
}

/** "due_date" -> "Due date" — good enough for a reason blurb without a template-field lookup. */
function formatFieldKey(key: string): string {
  const words = key.replaceAll("_", " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function greeting(now: Date): string {
  const hour = now.getHours()
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}

/** Home: a welcome header with the workspace's real pipeline counts as stat tiles, a jump back
 * into whatever's stuck in To review, the most recently touched files, and the finance-analytics
 * section when that module is enabled. Every number here comes from an actual query — no
 * placeholder metrics (a fields-extracted or time-saved tally isn't tracked anywhere, so neither
 * is shown) and no trial/billing copy, since getWorkspaceUsage reports every workspace as
 * unlimited today. */
export default async function WorkspaceHomePage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ period?: string; from?: string; to?: string }>
}) {
  const { workspaceId } = await params
  const query = await searchParams
  const user = await getCurrentUser()
  const membership = await requireWorkspaceRole(workspaceId, user.id)

  const capabilities = await getWorkspaceCapabilities(workspaceId)
  const hasAnalytics = capabilities.has("finance-analytics")
  const documentSearchEnabled = config.embeddings.enabled

  const [pipelineFile, usage, stageCounts, documentsThisMonth, recentFiles] = await Promise.all([
    ensurePipelineFile(workspaceId, user.id),
    getWorkspaceUsage(workspaceId),
    countDocumentsByStage(workspaceId),
    countDocumentsThisMonth(workspaceId),
    listRecentFiles(workspaceId, 4),
  ])
  const pipelineTemplates = await getFileTemplates(workspaceId, pipelineFile.id)
  const uploadTemplates: SheetTemplate[] = pipelineTemplates.flatMap((candidate) => {
    const version = candidate.versions[0]
    if (!version) return []
    return [{ id: candidate.id, code: candidate.code, name: candidate.name, multiRow: candidate.multiRow, documentCount: 0, fields: parseTemplateFields(version.fields), prompt: version.prompt || "" }]
  })

  const [needsReview, recentFileReviewCounts] = await Promise.all([
    listWorkspaceDocuments(workspaceId, { stage: "to_review" }),
    countToReviewByFile(workspaceId, recentFiles.map((file) => file.id)),
  ])

  const stats = [
    { label: "Documents this month", value: documentsThisMonth, icon: FileText, href: null, iconClass: "bg-emerald-50 text-emerald-700" },
    { label: "In review", value: stageCounts.to_review, icon: SearchCheck, href: `/workspaces/${workspaceId}/pipeline?stage=to_review`, iconClass: "bg-indigo-50 text-indigo-600" },
    { label: "Ready", value: stageCounts.ready, icon: CheckCircle2, href: `/workspaces/${workspaceId}/pipeline?stage=ready`, iconClass: "bg-emerald-50 text-emerald-700" },
    { label: "Archived", value: stageCounts.archive, icon: Archive, href: `/workspaces/${workspaceId}/pipeline?stage=archive`, iconClass: "bg-slate-100 text-slate-500" },
  ]

  return <main className="mx-auto w-full max-w-6xl space-y-6 p-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="mb-1.5 text-[12.5px] font-semibold uppercase tracking-wide text-slate-500">{greeting(new Date())}, {(user.name || user.email).split(" ")[0]}</p>
        <h1 className="text-[32px] font-extrabold tracking-tight text-slate-900">Welcome back to {membership.workspace.name}</h1>
        {stageCounts.to_review > 0 && <p className="mt-1.5 text-[14.5px] text-slate-500">{stageCounts.to_review} document{stageCounts.to_review === 1 ? " is" : "s are"} waiting for review across your pipeline.</p>}
      </div>
      <FileHubUploadButton
        workspaceId={workspaceId}
        fileId={pipelineFile.id}
        fileName="Pipeline"
        template={uploadTemplates[0] ?? null}
        templates={uploadTemplates}
        usage={usage}
        sheetCount={pipelineTemplates.length}
        documentSearchEnabled={documentSearchEnabled}
        primary />
    </header>

    <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
      {stats.map((stat) => {
        const inner = <>
          <div className={`mb-3.5 flex h-9 w-9 items-center justify-center rounded-lg ${stat.iconClass}`}><stat.icon className="h-[18px] w-[18px]" /></div>
          <div className="text-[26px] font-extrabold tracking-tight text-slate-900">{stat.value}</div>
          <div className="mt-0.5 text-[13px] text-slate-500">{stat.label}</div>
        </>
        const className = `rounded-xl border bg-white p-4 shadow-sm ${stat.href ? "transition-colors hover:border-slate-300" : ""}`
        return stat.href
          ? <Link key={stat.label} href={stat.href} className={className}>{inner}</Link>
          : <div key={stat.label} className={className}>{inner}</div>
      })}
    </div>

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.55fr_1fr]">
      <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-[15px] font-bold text-slate-900">Recent files</h2>
          <Link href={`/workspaces/${workspaceId}/files`} className="text-[13px] font-semibold text-emerald-700 hover:text-emerald-800">View all</Link>
        </div>
        {recentFiles.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-400">No files yet — upload something to get started.</p> : <div>
          {recentFiles.map((file) => {
            const reviewCount = recentFileReviewCounts[file.id] ?? 0
            return <Link key={file.id} href={`/workspaces/${workspaceId}/files/${file.id}`} className="flex items-center gap-3 border-b px-5 py-3 last:border-b-0 hover:bg-slate-50">
              <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Table2 className="h-[17px] w-[17px]" /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-800">{file.name}</div>
                <div className="text-xs text-slate-400">{file._count.documents} document{file._count.documents === 1 ? "" : "s"}{file.folder ? ` · in ${file.folder.name}` : ""}</div>
              </div>
              <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${reviewCount > 0 ? "bg-indigo-50 text-indigo-700" : "bg-emerald-50 text-emerald-700"}`}>
                {reviewCount > 0 ? `${reviewCount} in review` : "Done"}
              </span>
              <span className="w-[74px] shrink-0 text-right text-xs text-slate-400"><LastUpdated iso={file.updatedAt.toISOString()} /></span>
            </Link>
          })}
        </div>}
      </div>

      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="mb-3.5 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><SearchCheck className="h-[17px] w-[17px]" /></span>
          <h2 className="text-[15px] font-bold text-slate-900">Needs your review</h2>
          {stageCounts.to_review > 0 && <span className="ml-auto rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11.5px] font-bold text-indigo-700">{stageCounts.to_review}</span>}
        </div>
        {needsReview.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Nothing needs a look right now.</p> : <>
          {needsReview.slice(0, 3).map((doc) => {
            const reasons = flaggedFieldsFromConfidence(doc.confidence).slice(0, 2).map(formatFieldKey)
            const review = summarizeDocumentForReview(doc)
            return <Link key={doc.id} href={`/workspaces/${workspaceId}/documents/${doc.id}?stage=to_review`} className="flex items-center gap-2.5 border-t py-2.5 first:border-t-0 hover:text-emerald-800">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold text-slate-800">{review.supplier ?? "Unknown supplier"} · {review.category}{review.total ? ` · ${review.total}` : ""}</div>
                <div className="text-xs text-slate-500">{reasons.length > 0 ? `${reasons.join(", ")} unclear` : "Ready for a look"}</div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
            </Link>
          })}
        </>}
        <Link href={`/workspaces/${workspaceId}/pipeline?stage=to_review`} className="mt-3.5 block rounded-lg bg-slate-900 px-3 py-2.5 text-center text-[13.5px] font-semibold text-white hover:bg-slate-800">
          Open the review queue →
        </Link>
      </div>
    </div>

    {hasAnalytics && <AnalyticsSection workspaceId={workspaceId} query={query} />}
  </main>
}

/** The finance-analytics workspace's old Overview page body, moved here verbatim behind the
 * capability check rather than gating the whole route. */
async function AnalyticsSection({ workspaceId, query }: { workspaceId: string; query: { period?: string; from?: string; to?: string } }) {
  const today = new Date()
  const period = resolvePeriod(query, today)
  const analytics = await getWorkspaceAnalytics(workspaceId, period, today)
  const money = (value: number) => formatMoney(value, analytics.currency.baseCurrency)

  return <section className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Analytics</h2>
        <p className="mt-1 text-sm text-slate-500">Spend, cash flow, and what&apos;s owed — built from your extracted documents.</p>
      </div>
      <PeriodFilter workspaceId={workspaceId} current={period.key}
        from={period.from ? period.from.toISOString().slice(0, 10) : ""}
        to={period.to ? period.to.toISOString().slice(0, 10) : ""} />
    </header>

    {analytics.currency.hasMultipleCurrencies && <p className="rounded border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
      Totals mix multiple currencies — amounts are summed as extracted, with no conversion.
    </p>}

    <HeadlineCards workspaceId={workspaceId} totalSpend={analytics.headline.totalSpend} totalOutstanding={analytics.headline.totalOutstanding}
      netCashFlow={analytics.headline.netCashFlow} openReviewTasks={analytics.headline.openReviewTasks} formatMoney={money} />

    <div className="space-y-8 rounded border p-5">
      <SpendByCategoryChart workspaceId={workspaceId} rows={analytics.spend} formatMoney={money} />
    </div>

    <div className="rounded border p-5">
      <CashFlowChart months={analytics.cashFlow} formatMoney={money} />
    </div>

    <div className="rounded border p-5">
      <ApAgingChart workspaceId={workspaceId} aging={analytics.aging} formatMoney={money} />
    </div>
  </section>
}
