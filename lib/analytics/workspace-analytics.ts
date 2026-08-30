import { prisma } from "@/lib/db"
import { getTaxProfile } from "@/models/tax-profiles"

/** Workspace-scoped finance analytics: spend by category, cash-flow trend, and AP aging, read
 * straight from the structured document_field_values projection (never ProductEvent, which is a
 * product-telemetry table with no relation to a workspace's own finances).
 *
 * Same hand-written-SQL convention as models/document-field-values.ts, for the same reason: every
 * statement is a pure `build*Sql(): Sql` function returning parameterised text and ordered bind
 * values, so it can be asserted in a unit test without a database. Every value is a bind — nothing
 * is interpolated — and workspace_id is bound on every document_field_values join alias, not just
 * the outer WHERE, so a filter can never be widened past one workspace.
 *
 * Known limitation, surfaced in the UI rather than hidden: an invoice's total (from the document
 * projection) and a bank statement's debit for the same payment are two independent series here —
 * this table has no reconciliation between them, which is bank-match's job, not analytics'. Cash
 * Flow Trend shows both rather than pretending they agree. Spend by Category is costs and expenses
 * only; sales/revenue is not tracked anywhere in this app yet. */

export type Sql = { text: string; params: unknown[] }

/** Every document status past intake — the point at which a document has field values worth
 * summing. Matches the NOT IN list on every query below. */
const POST_INTAKE_STATUSES = ["received", "queued", "failed"]

const EXPENSE_TEMPLATE_CODES = ["invoice", "receipt", "expense_receipt"]

export type PeriodKey = "30d" | "90d" | "12m" | "custom"
export type Period = { key: PeriodKey; from: Date | null; to: Date | null }

export type SpendByCategoryRow = { category: string; totalSpend: number; documentCount: number }

export type CashFlowMonth = {
  month: string
  documentOutflow: number
  bankDebits: number
  bankCredits: number
  outflow: number
  net: number
}

export type AgingBucketKey = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus" | "no_due_date"

export const AGING_BUCKET_KEYS: AgingBucketKey[] = ["current", "d1_30", "d31_60", "d61_90", "d90_plus", "no_due_date"]

export type UnpaidInvoiceRow = {
  documentId: string
  fileId: string
  filename: string
  vendor: string | null
  total: number
  dueDate: Date | null
  bucket: AgingBucketKey
}

export type ApAging = {
  buckets: Record<AgingBucketKey, { total: number; count: number }>
  invoices: UnpaidInvoiceRow[]
  truncated: boolean
}

export type CurrencyContext = { baseCurrency: string | null; hasMultipleCurrencies: boolean }

export type WorkspaceAnalytics = {
  period: Period
  spend: SpendByCategoryRow[]
  cashFlow: CashFlowMonth[]
  aging: ApAging
  currency: CurrencyContext
  headline: {
    totalSpend: number
    totalOutstanding: number
    netCashFlow: number
    openReviewTasks: number
  }
}

// ---- Pure functions (exported for tests) --------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function parseIsoDate(value: string): Date | null {
  return ISO_DATE.test(value) ? new Date(`${value}T00:00:00.000Z`) : null
}

/** Resolves the period a page's `?period=` / `?from=&to=` searchParams describe. An explicit
 * `from`/`to` (either one) wins as "custom"; otherwise `period` selects a rolling window ending
 * today, defaulting to 12m for an absent or unrecognised value. Never throws — a garbage `from`/`to`
 * is dropped, not surfaced as an error, since this only ever drives a read. */
export function resolvePeriod(searchParams: { period?: string; from?: string; to?: string }, today: Date): Period {
  const from = searchParams.from ? parseIsoDate(searchParams.from) : null
  const to = searchParams.to ? parseIsoDate(searchParams.to) : null
  if (from || to) return { key: "custom", from, to }

  const key: PeriodKey = searchParams.period === "30d" || searchParams.period === "90d" ? searchParams.period : "12m"
  const start = new Date(today)
  if (key === "30d") start.setUTCDate(start.getUTCDate() - 30)
  else if (key === "90d") start.setUTCDate(start.getUTCDate() - 90)
  else start.setUTCMonth(start.getUTCMonth() - 12)
  return { key, from: start, to: today }
}

/** Which AP-aging bucket a due date falls into today. `null` (no due date extracted) gets its own
 * bucket rather than being silently dropped or lumped into "current" — an invoice with a missing
 * due date is exactly the kind of gap this view exists to surface. A due date of today or later is
 * "current"; strictly past due buckets in 30-day bands. */
export function assignAgingBucket(dueDate: Date | null, today: Date): AgingBucketKey {
  if (!dueDate) return "no_due_date"
  const msPerDay = 24 * 60 * 60 * 1000
  const daysOverdue = Math.floor((today.getTime() - dueDate.getTime()) / msPerDay)
  if (daysOverdue <= 0) return "current"
  if (daysOverdue <= 30) return "d1_30"
  if (daysOverdue <= 60) return "d31_60"
  if (daysOverdue <= 90) return "d61_90"
  return "d90_plus"
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}

/** Every "YYYY-MM" in [from, to] inclusive, oldest first. Falls back to the trailing 12 months
 * ending `today` when the period is unbounded (a "custom" period with only one side filled in). */
function monthsInPeriod(period: Period, today: Date): string[] {
  const to = period.to ?? today
  const from = period.from ?? (() => { const d = new Date(to); d.setUTCMonth(d.getUTCMonth() - 12); return d })()
  const months: string[] = []
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1))
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1))
  while (cursor.getTime() <= end.getTime()) {
    months.push(monthKey(cursor))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return months
}

/** Zero-fills the month series so a chart never silently skips a month with no activity — a gap in
 * the middle of a trend reads as "no data collected" rather than "nothing happened", which is the
 * wrong story for a workspace that genuinely had zero spend that month. */
export function fillMonthSeries(
  docRows: { month: string; documentOutflow: number | null }[],
  bankRows: { month: string; bankDebits: number | null; bankCredits: number | null }[],
  period: Period,
  today: Date,
): CashFlowMonth[] {
  const docByMonth = new Map(docRows.map((row) => [row.month, row.documentOutflow ?? 0]))
  const bankByMonth = new Map(bankRows.map((row) => [row.month, { debits: row.bankDebits ?? 0, credits: row.bankCredits ?? 0 }]))
  return monthsInPeriod(period, today).map((month) => {
    const documentOutflow = docByMonth.get(month) ?? 0
    const bank = bankByMonth.get(month) ?? { debits: 0, credits: 0 }
    const outflow = documentOutflow + bank.debits
    return { month, documentOutflow, bankDebits: bank.debits, bankCredits: bank.credits, outflow, net: bank.credits - outflow }
  })
}

/** The workspace's base currency: the tax profile's configured currency if one exists, otherwise
 * the most common currency actually seen across extracted documents. `hasMultipleCurrencies` flags
 * when totals get summed across currencies with no conversion — the UI's amber banner reads off
 * this rather than re-deriving it. */
export function resolveCurrency(taxCurrency: string | null, inventory: { currency: string; count: number }[]): CurrencyContext {
  if (taxCurrency) return { baseCurrency: taxCurrency, hasMultipleCurrencies: inventory.length > 1 }
  if (!inventory.length) return { baseCurrency: null, hasMultipleCurrencies: false }
  return { baseCurrency: inventory[0].currency, hasMultipleCurrencies: inventory.length > 1 }
}

// ---- Pure SQL builders (tested directly) ---------------------------------------------------------

/** Appends a value_date range predicate against `column`, bound only when the period actually
 * constrains that side — an unbounded period must produce no date predicate at all, not one that
 * happens to always be true. */
function periodPredicates(column: string, period: Period, bind: (value: unknown) => string): string[] {
  const predicates: string[] = []
  if (period.from) predicates.push(`${column} >= ${bind(period.from)}::date`)
  if (period.to) predicates.push(`${column} <= ${bind(period.to)}::date`)
  return predicates
}

/** Spend grouped by `documents.coding_data->>'account'` (falling back to "Uncategorized"), summed
 * from each expense document's `total` field value. The category date comes from a second,
 * template-dependent field (`issue_date` for invoices, `purchase_date` for everything else) joined
 * as LEFT so a document missing that field still contributes to the all-time total — it only drops
 * out once a bounded period's date predicate excludes it for having no date to compare. */
export function buildSpendByCategorySql(workspaceId: string, period: Period): Sql {
  const params: unknown[] = []
  const bind = (value: unknown) => { params.push(value); return `$${params.length}` }
  const workspaceRef = `${bind(workspaceId)}::uuid`
  const where = [
    `d."workspace_id" = ${workspaceRef}`,
    `d."status" NOT IN (${POST_INTAKE_STATUSES.map((status) => bind(status)).join(", ")})`,
    ...periodPredicates(`dt."value_date"`, period, bind),
  ]
  return {
    text: `SELECT COALESCE(NULLIF(btrim(d."coding_data"->>'account'), ''), 'Uncategorized') AS "category",
        SUM(total."value_number") AS "totalSpend",
        COUNT(DISTINCT d."id")::int AS "documentCount"
      FROM "documents" d
      JOIN "document_field_values" total ON total."document_id" = d."id" AND total."workspace_id" = ${workspaceRef}
        AND total."field_key" = 'total' AND total."item_key" IS NULL
        AND total."template_code" IN (${EXPENSE_TEMPLATE_CODES.map((code) => bind(code)).join(", ")})
      LEFT JOIN "document_field_values" dt ON dt."document_id" = d."id" AND dt."workspace_id" = ${workspaceRef}
        AND dt."item_key" IS NULL
        AND dt."field_key" = CASE total."template_code" WHEN 'invoice' THEN 'issue_date' ELSE 'purchase_date' END
      WHERE ${where.join(" AND ")}
      GROUP BY "category"
      ORDER BY "totalSpend" DESC`,
    params,
  }
}

/** Monthly total of the same `total` field values as buildSpendByCategorySql, grouped by the
 * document's own date. Unlike the category query this join is INNER — a document with no date to
 * bucket it by cannot appear in a month-by-month trend at all. */
export function buildDocumentOutflowByMonthSql(workspaceId: string, period: Period): Sql {
  const params: unknown[] = []
  const bind = (value: unknown) => { params.push(value); return `$${params.length}` }
  const workspaceRef = `${bind(workspaceId)}::uuid`
  const where = [
    `d."workspace_id" = ${workspaceRef}`,
    `d."status" NOT IN (${POST_INTAKE_STATUSES.map((status) => bind(status)).join(", ")})`,
    ...periodPredicates(`dt."value_date"`, period, bind),
  ]
  return {
    text: `SELECT to_char(date_trunc('month', dt."value_date"), 'YYYY-MM') AS "month",
        SUM(total."value_number") AS "documentOutflow"
      FROM "documents" d
      JOIN "document_field_values" total ON total."document_id" = d."id" AND total."workspace_id" = ${workspaceRef}
        AND total."field_key" = 'total' AND total."item_key" IS NULL
        AND total."template_code" IN (${EXPENSE_TEMPLATE_CODES.map((code) => bind(code)).join(", ")})
      JOIN "document_field_values" dt ON dt."document_id" = d."id" AND dt."workspace_id" = ${workspaceRef}
        AND dt."item_key" IS NULL
        AND dt."field_key" = CASE total."template_code" WHEN 'invoice' THEN 'issue_date' ELSE 'purchase_date' END
      WHERE ${where.join(" AND ")}
      GROUP BY "month"
      ORDER BY "month"`,
    params,
  }
}

/** Monthly bank-statement debit/credit totals. `bank_statement` documents project one
 * `transactions` field with one row per line: a `transaction_date` value and, on the SAME
 * (workspace_id, document_id, row_index), a `debit` or `credit` value — self-joined on that triple
 * to pair a line's date with its amount. */
export function buildBankFlowByMonthSql(workspaceId: string, period: Period): Sql {
  const params: unknown[] = []
  const bind = (value: unknown) => { params.push(value); return `$${params.length}` }
  const workspaceRef = `${bind(workspaceId)}::uuid`
  const where = [
    `dt."workspace_id" = ${workspaceRef}`,
    `dt."field_key" = 'transactions'`,
    `dt."item_key" = 'transaction_date'`,
    `d."status" NOT IN (${POST_INTAKE_STATUSES.map((status) => bind(status)).join(", ")})`,
    ...periodPredicates(`dt."value_date"`, period, bind),
  ]
  return {
    text: `SELECT to_char(date_trunc('month', dt."value_date"), 'YYYY-MM') AS "month",
        SUM(amt."value_number") FILTER (WHERE amt."item_key" = 'debit') AS "bankDebits",
        SUM(amt."value_number") FILTER (WHERE amt."item_key" = 'credit') AS "bankCredits"
      FROM "document_field_values" dt
      JOIN "document_field_values" amt ON amt."workspace_id" = dt."workspace_id" AND amt."document_id" = dt."document_id"
        AND amt."row_index" = dt."row_index" AND amt."field_key" = 'transactions' AND amt."item_key" IN ('debit', 'credit')
      JOIN "documents" d ON d."id" = dt."document_id"
      WHERE ${where.join(" AND ")}
      GROUP BY "month"
      ORDER BY "month"`,
    params,
  }
}

/** Invoices with a total but no `succeeded` push to an accounting system — "unpaid" as far as this
 * app can tell. `limit` is fetched +1 so the caller can flag `truncated` without a second query,
 * same pattern as findDocumentsByFields. */
export function buildUnpaidInvoicesSql(workspaceId: string, limit = 500): Sql {
  const params: unknown[] = []
  const bind = (value: unknown) => { params.push(value); return `$${params.length}` }
  const workspaceRef = `${bind(workspaceId)}::uuid`
  return {
    text: `SELECT d."id" AS "documentId", d."file_id" AS "fileId", d."filename",
        vendor."value_text" AS "vendor", total."value_number" AS "total", due."value_date" AS "dueDate"
      FROM "documents" d
      JOIN "document_field_values" total ON total."document_id" = d."id" AND total."workspace_id" = ${workspaceRef}
        AND total."field_key" = 'total' AND total."item_key" IS NULL AND total."template_code" = 'invoice'
      LEFT JOIN "document_field_values" due ON due."document_id" = d."id" AND due."workspace_id" = ${workspaceRef}
        AND due."field_key" = 'due_date' AND due."item_key" IS NULL
      LEFT JOIN "document_field_values" vendor ON vendor."document_id" = d."id" AND vendor."workspace_id" = ${workspaceRef}
        AND vendor."field_key" = 'vendor' AND vendor."item_key" IS NULL
      WHERE d."workspace_id" = ${workspaceRef}
        AND d."status" NOT IN (${POST_INTAKE_STATUSES.map((status) => bind(status)).join(", ")})
        AND NOT EXISTS (
          SELECT 1 FROM "integration_pushes" p
          WHERE p."workspace_id" = ${workspaceRef} AND p."document_id" = d."id" AND p."status" = 'succeeded'
        )
      ORDER BY due."value_date" ASC NULLS LAST
      LIMIT ${bind(limit + 1)}`,
    params,
  }
}

/** Distinct `currency_code` values extracted anywhere in the workspace, most common first — the
 * fallback resolveCurrency uses when no tax profile sets a base currency. */
export function buildCurrencyInventorySql(workspaceId: string): Sql {
  const params: unknown[] = []
  const bind = (value: unknown) => { params.push(value); return `$${params.length}` }
  const workspaceRef = `${bind(workspaceId)}::uuid`
  return {
    text: `SELECT "value_text" AS "currency", COUNT(*)::int AS "count"
      FROM "document_field_values"
      WHERE "workspace_id" = ${workspaceRef} AND "field_key" = 'currency_code' AND "item_key" IS NULL AND "value_text" IS NOT NULL
      GROUP BY "value_text"
      ORDER BY "count" DESC`,
    params,
  }
}

// ---- Execution ------------------------------------------------------------------------------------

type SpendRow = { category: string; totalSpend: string | number | null; documentCount: number }
type DocOutflowRow = { month: string; documentOutflow: string | number | null }
type BankFlowRow = { month: string; bankDebits: string | number | null; bankCredits: string | number | null }
type UnpaidInvoiceSqlRow = { documentId: string; fileId: string; filename: string; vendor: string | null; total: string | number | null; dueDate: Date | null }
type CurrencyRow = { currency: string; count: number }

const toNumber = (value: string | number | null): number => (value == null ? 0 : Number(value))

/** Everything the Overview page needs, gathered in one pass. `today` is a caller-supplied Date
 * (never computed inside — Workflow scripts and other callers may need a fixed reference point) used
 * both to resolve an unbounded month series and to bucket invoice aging. */
export async function getWorkspaceAnalytics(workspaceId: string, period: Period, today: Date = new Date()): Promise<WorkspaceAnalytics> {
  const spendSql = buildSpendByCategorySql(workspaceId, period)
  const docOutflowSql = buildDocumentOutflowByMonthSql(workspaceId, period)
  const bankFlowSql = buildBankFlowByMonthSql(workspaceId, period)
  const unpaidSql = buildUnpaidInvoicesSql(workspaceId)
  const currencySql = buildCurrencyInventorySql(workspaceId)

  const [spendRows, docOutflowRows, bankFlowRows, unpaidRows, currencyRows, taxProfile, openReviewTasks] = await Promise.all([
    prisma.$queryRawUnsafe<SpendRow[]>(spendSql.text, ...spendSql.params),
    prisma.$queryRawUnsafe<DocOutflowRow[]>(docOutflowSql.text, ...docOutflowSql.params),
    prisma.$queryRawUnsafe<BankFlowRow[]>(bankFlowSql.text, ...bankFlowSql.params),
    prisma.$queryRawUnsafe<UnpaidInvoiceSqlRow[]>(unpaidSql.text, ...unpaidSql.params),
    prisma.$queryRawUnsafe<CurrencyRow[]>(currencySql.text, ...currencySql.params),
    getTaxProfile(workspaceId),
    prisma.reviewTask.count({ where: { workspaceId, status: "open" } }),
  ])

  const spend: SpendByCategoryRow[] = spendRows.map((row) => ({ category: row.category, totalSpend: toNumber(row.totalSpend), documentCount: Number(row.documentCount) }))
  const cashFlow = fillMonthSeries(
    docOutflowRows.map((row) => ({ month: row.month, documentOutflow: toNumber(row.documentOutflow) })),
    bankFlowRows.map((row) => ({ month: row.month, bankDebits: toNumber(row.bankDebits), bankCredits: toNumber(row.bankCredits) })),
    period,
    today,
  )

  const UNPAID_LIMIT = 500
  const truncated = unpaidRows.length > UNPAID_LIMIT
  const buckets = Object.fromEntries(AGING_BUCKET_KEYS.map((key) => [key, { total: 0, count: 0 }])) as ApAging["buckets"]
  const invoices: UnpaidInvoiceRow[] = unpaidRows.slice(0, UNPAID_LIMIT).map((row) => {
    const bucket = assignAgingBucket(row.dueDate, today)
    const total = toNumber(row.total)
    buckets[bucket].total += total
    buckets[bucket].count += 1
    return { documentId: row.documentId, fileId: row.fileId, filename: row.filename, vendor: row.vendor, total, dueDate: row.dueDate, bucket }
  })

  const currency = resolveCurrency(taxProfile?.config.currency ?? null, currencyRows)
  const totalOutstanding = AGING_BUCKET_KEYS.reduce((sum, key) => sum + buckets[key].total, 0)
  const totalSpend = spend.reduce((sum, row) => sum + row.totalSpend, 0)
  const netCashFlow = cashFlow.reduce((sum, month) => sum + month.net, 0)

  return {
    period,
    spend,
    cashFlow,
    aging: { buckets, invoices, truncated },
    currency,
    headline: { totalSpend, totalOutstanding, netCashFlow, openReviewTasks },
  }
}
