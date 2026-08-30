import { ApAgingChart } from "@/components/analytics/ap-aging-chart"
import { CashFlowChart } from "@/components/analytics/cash-flow-chart"
import { PeriodFilter } from "@/components/analytics/period-filter"
import { HeadlineCards } from "@/components/analytics/stat-cards"
import { SpendByCategoryChart } from "@/components/analytics/spend-by-category-chart"
import { getCurrentUser } from "@/lib/auth"
import { getWorkspaceAnalytics, resolvePeriod } from "@/lib/analytics/workspace-analytics"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { countOpenReviewTasks } from "@/models/review-tasks"
import { requireWorkspaceRole } from "@/models/workspaces"
import { ClipboardCheck, Files } from "lucide-react"
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

/** The one Home every workspace lands on post-login: a link into Files, plus the review count
 * and analytics section when their modules are enabled. File creation and upload live only on
 * Files now — Home is just the jumping-off point, not a second copy of those actions. */
export default async function WorkspaceHomePage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ period?: string; from?: string; to?: string }>
}) {
  const { workspaceId } = await params
  const query = await searchParams
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)

  const capabilities = await getWorkspaceCapabilities(workspaceId)
  const hasReviewQueue = capabilities.has("review-queue")
  const hasAnalytics = capabilities.has("finance-analytics")

  const openReviewCount = hasReviewQueue ? await countOpenReviewTasks(workspaceId) : 0

  return <main className="mx-auto w-full max-w-6xl space-y-6 p-6">
    <header>
      <h1 className="text-3xl font-bold text-stone-900">Home</h1>
      <p className="mt-1 text-sm text-stone-500">Jump back in, or start something new.</p>
    </header>

    <Link href={`/workspaces/${workspaceId}/files`}
      className="flex items-center gap-3 rounded border bg-white p-4 hover:border-emerald-300 hover:bg-emerald-50/40">
      <Files className="h-5 w-5 shrink-0 text-emerald-700" />
      <div>
        <p className="font-semibold text-stone-900">Files</p>
        <p className="text-sm text-stone-500">Browse, search, and manage everything in this workspace.</p>
      </div>
    </Link>

    {hasReviewQueue && <Link href={`/workspaces/${workspaceId}/review`}
      className="flex items-center gap-3 rounded border bg-white p-4 hover:border-emerald-300 hover:bg-emerald-50/40">
      <ClipboardCheck className="h-5 w-5 shrink-0 text-emerald-700" />
      <div>
        <p className="font-semibold text-stone-900">Awaiting review: {openReviewCount}</p>
        <p className="text-sm text-stone-500">Documents that need a person to look at them.</p>
      </div>
    </Link>}

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
        <h2 className="text-xl font-bold text-stone-900">Analytics</h2>
        <p className="mt-1 text-sm text-stone-500">Spend, cash flow, and what&apos;s owed — built from your extracted documents.</p>
      </div>
      <PeriodFilter workspaceId={workspaceId} current={period.key}
        from={period.from ? period.from.toISOString().slice(0, 10) : ""}
        to={period.to ? period.to.toISOString().slice(0, 10) : ""} />
    </header>

    {analytics.currency.hasMultipleCurrencies && <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
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
