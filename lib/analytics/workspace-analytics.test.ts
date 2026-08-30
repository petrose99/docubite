import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/models/tax-profiles", () => ({ getTaxProfile: vi.fn() }))

const {
  assignAgingBucket,
  buildBankFlowByMonthSql,
  buildCurrencyInventorySql,
  buildDocumentOutflowByMonthSql,
  buildSpendByCategorySql,
  buildUnpaidInvoicesSql,
  fillMonthSeries,
  resolveCurrency,
  resolvePeriod,
} = await import("@/lib/analytics/workspace-analytics")

const WS = "11111111-1111-1111-1111-111111111111"
const TODAY = new Date("2026-08-29T00:00:00.000Z")
const UNBOUNDED = { key: "custom" as const, from: null, to: null }

describe("resolvePeriod", () => {
  it("defaults to a trailing 12m window", () => {
    const period = resolvePeriod({}, TODAY)
    expect(period.key).toBe("12m")
    expect(period.from?.toISOString()).toBe("2025-08-29T00:00:00.000Z")
    expect(period.to?.toISOString()).toBe(TODAY.toISOString())
  })

  it("resolves 30d and 90d windows", () => {
    expect(resolvePeriod({ period: "30d" }, TODAY).from?.toISOString()).toBe("2026-07-30T00:00:00.000Z")
    expect(resolvePeriod({ period: "90d" }, TODAY).from?.toISOString()).toBe("2026-05-31T00:00:00.000Z")
  })

  it("falls back to 12m for a garbage period value", () => {
    expect(resolvePeriod({ period: "nonsense" }, TODAY).key).toBe("12m")
  })

  it("treats an explicit from/to as custom, dropping unparsable sides", () => {
    const period = resolvePeriod({ from: "2026-01-01", to: "not-a-date" }, TODAY)
    expect(period.key).toBe("custom")
    expect(period.from?.toISOString()).toBe("2026-01-01T00:00:00.000Z")
    expect(period.to).toBeNull()
  })

  it("ignores period when from/to is present", () => {
    const period = resolvePeriod({ period: "30d", from: "2026-01-01" }, TODAY)
    expect(period.key).toBe("custom")
  })
})

describe("assignAgingBucket", () => {
  const day = (n: number) => new Date(TODAY.getTime() - n * 24 * 60 * 60 * 1000)

  it("has no due date -> no_due_date", () => {
    expect(assignAgingBucket(null, TODAY)).toBe("no_due_date")
  })

  it("due today or in the future -> current", () => {
    expect(assignAgingBucket(TODAY, TODAY)).toBe("current")
    expect(assignAgingBucket(day(-5), TODAY)).toBe("current")
  })

  it("buckets each 30-day band at its boundaries", () => {
    expect(assignAgingBucket(day(1), TODAY)).toBe("d1_30")
    expect(assignAgingBucket(day(30), TODAY)).toBe("d1_30")
    expect(assignAgingBucket(day(31), TODAY)).toBe("d31_60")
    expect(assignAgingBucket(day(60), TODAY)).toBe("d31_60")
    expect(assignAgingBucket(day(61), TODAY)).toBe("d61_90")
    expect(assignAgingBucket(day(90), TODAY)).toBe("d61_90")
    expect(assignAgingBucket(day(91), TODAY)).toBe("d90_plus")
  })
})

describe("fillMonthSeries", () => {
  it("zero-fills every month in a bounded period", () => {
    const period = { key: "custom" as const, from: new Date("2026-06-01T00:00:00.000Z"), to: new Date("2026-08-01T00:00:00.000Z") }
    const months = fillMonthSeries([], [], period, TODAY)
    expect(months.map((m) => m.month)).toEqual(["2026-06", "2026-07", "2026-08"])
    expect(months.every((m) => m.documentOutflow === 0 && m.bankDebits === 0 && m.bankCredits === 0 && m.net === 0)).toBe(true)
  })

  it("falls back to 12 trailing months when the period is unbounded", () => {
    const months = fillMonthSeries([], [], UNBOUNDED, TODAY)
    expect(months).toHaveLength(13)
    expect(months[months.length - 1].month).toBe("2026-08")
  })

  it("merges document outflow and bank flow, computing net = credits - (docOutflow + debits)", () => {
    const period = { key: "custom" as const, from: new Date("2026-08-01T00:00:00.000Z"), to: new Date("2026-08-01T00:00:00.000Z") }
    const months = fillMonthSeries(
      [{ month: "2026-08", documentOutflow: 100 }],
      [{ month: "2026-08", bankDebits: 20, bankCredits: 50 }],
      period,
      TODAY,
    )
    expect(months).toEqual([{ month: "2026-08", documentOutflow: 100, bankDebits: 20, bankCredits: 50, outflow: 120, net: -70 }])
  })
})

describe("resolveCurrency", () => {
  it("prefers the tax profile currency", () => {
    expect(resolveCurrency("ZAR", [{ currency: "USD", count: 5 }])).toEqual({ baseCurrency: "ZAR", hasMultipleCurrencies: false })
    expect(resolveCurrency("ZAR", [{ currency: "USD", count: 5 }, { currency: "GBP", count: 2 }])).toEqual({ baseCurrency: "ZAR", hasMultipleCurrencies: true })
  })

  it("falls back to the most common extracted currency", () => {
    expect(resolveCurrency(null, [{ currency: "USD", count: 5 }, { currency: "GBP", count: 1 }])).toEqual({ baseCurrency: "USD", hasMultipleCurrencies: true })
  })

  it("reports no currency for an empty workspace", () => {
    expect(resolveCurrency(null, [])).toEqual({ baseCurrency: null, hasMultipleCurrencies: false })
  })

  it("flags a single currency as not mixed", () => {
    expect(resolveCurrency(null, [{ currency: "USD", count: 5 }])).toEqual({ baseCurrency: "USD", hasMultipleCurrencies: false })
  })
})

describe("SQL builders bind workspace_id and never interpolate it", () => {
  it("buildSpendByCategorySql binds workspaceId as the first param and never inlines it as a literal", () => {
    const sql = buildSpendByCategorySql(WS, UNBOUNDED)
    expect(sql.params[0]).toBe(WS)
    expect(sql.text).not.toContain(WS)
    expect(sql.text).toContain(`d."workspace_id" = $1::uuid`)
    expect(sql.text).toContain(`total."workspace_id" = $1::uuid`)
    expect(sql.text).toContain(`dt."workspace_id" = $1::uuid`)
  })

  it("adds no date predicate for an unbounded period, and both for a fully bounded one", () => {
    const unbounded = buildSpendByCategorySql(WS, UNBOUNDED)
    expect(unbounded.text).not.toContain(`dt."value_date"`)

    const bounded = buildSpendByCategorySql(WS, { key: "custom", from: new Date("2026-01-01"), to: new Date("2026-02-01") })
    expect(bounded.text).toContain(`dt."value_date" >=`)
    expect(bounded.text).toContain(`dt."value_date" <=`)
  })

  it("buildDocumentOutflowByMonthSql binds workspace_id on every alias", () => {
    const sql = buildDocumentOutflowByMonthSql(WS, UNBOUNDED)
    expect(sql.text).toContain(`d."workspace_id" = $1::uuid`)
    expect(sql.text).toContain(`total."workspace_id" = $1::uuid`)
    expect(sql.text).toContain(`dt."workspace_id" = $1::uuid`)
    expect(sql.text).not.toContain(WS)
  })

  it("buildBankFlowByMonthSql binds workspace_id and correlates the self-join on (workspace_id, document_id, row_index)", () => {
    const sql = buildBankFlowByMonthSql(WS, UNBOUNDED)
    expect(sql.text).toContain(`dt."workspace_id" = $1::uuid`)
    expect(sql.text).toContain(`amt."workspace_id" = dt."workspace_id"`)
    expect(sql.text).toContain(`amt."document_id" = dt."document_id"`)
    expect(sql.text).toContain(`amt."row_index" = dt."row_index"`)
  })

  it("buildUnpaidInvoicesSql excludes documents with a succeeded push via correlated NOT EXISTS", () => {
    const sql = buildUnpaidInvoicesSql(WS)
    expect(sql.text).toContain(`NOT EXISTS`)
    expect(sql.text).toContain(`p."status" = 'succeeded'`)
    expect(sql.text).toContain(`p."workspace_id" = $1::uuid`)
    expect(sql.text).toContain(`p."document_id" = d."id"`)
    expect(sql.text).not.toContain(WS)
  })

  it("buildUnpaidInvoicesSql fetches limit+1 rows so truncation can be detected without a second query", () => {
    const sql = buildUnpaidInvoicesSql(WS, 10)
    expect(sql.params.at(-1)).toBe(11)
  })

  it("buildCurrencyInventorySql binds workspace_id and never interpolates it", () => {
    const sql = buildCurrencyInventorySql(WS)
    expect(sql.params).toEqual([WS])
    expect(sql.text).toContain(`"workspace_id" = $1::uuid`)
    expect(sql.text).not.toContain(WS)
  })
})
