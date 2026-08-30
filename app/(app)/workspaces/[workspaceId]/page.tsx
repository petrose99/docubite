import { ApAgingChart } from "@/components/analytics/ap-aging-chart"
import { CashFlowChart } from "@/components/analytics/cash-flow-chart"
import { PeriodFilter } from "@/components/analytics/period-filter"
import { HeadlineCards } from "@/components/analytics/stat-cards"
import { SpendByCategoryChart } from "@/components/analytics/spend-by-category-chart"
import { getCurrentUser } from "@/lib/auth"
import { getWorkspaceAnalytics, resolvePeriod } from "@/lib/analytics/workspace-analytics"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { paths } from "@/app/(app)/workspaces/[workspaceId]/action-helpers"
import { requireWorkspaceRole } from "@/models/workspaces"
import { redirect } from "next/navigation"

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

/** The workspace home for finance-industry workspaces: spend, cash flow, and AP aging built
 * straight from extracted documents, so a business owner can see where their money went without
 * opening a single file. Every other industry has no analytics module enabled, so this route
 * bounces them to Files exactly as it did before this page existed. */
export default async function WorkspaceOverviewPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ period?: string; from?: string; to?: string }>
}) {
  const { workspaceId } = await params
  const query = await searchParams
  const user = await getCurrentUser()
  await requireWorkspaceRole(workspaceId, user.id)

  const capabilities = await getWorkspaceCapabilities(workspaceId)
  if (!capabilities.has("finance-analytics")) redirect(paths(workspaceId).files)

  const today = new Date()
  const period = resolvePeriod(query, today)
  const analytics = await getWorkspaceAnalytics(workspaceId, period, today)
  const money = (value: number) => formatMoney(value, analytics.currency.baseCurrency)

  return <main className="mx-auto w-full max-w-6xl space-y-6 p-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold text-stone-900">Overview</h1>
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
  </main>
}
