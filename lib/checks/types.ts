export type CheckStatus = "pass" | "warn" | "fail"

export type CheckResult = {
  checkCode: string
  status: CheckStatus
  message: string
  detail?: Record<string, unknown>
}

/** Every currency this app extracts a `currency_code` for (lib/domains/finance.ts's templates)
 * that has no minor unit — a "cent" is meaningless for these, so a check comparing amounts must
 * round to whole units instead of the usual two decimal places. Not exhaustive of ISO 4217's
 * zero-decimal list, only the ones plausible for this app's launch regions plus the handful most
 * likely to show up in a real invoice regardless of region. */
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XOF", "XAF"])

/** The smallest amount that should count as "different" for one currency — half a minor unit,
 * so ordinary floating-point rounding noise (0.1 + 0.2 !== 0.3) never trips a check, while an
 * actual one-cent-or-more discrepancy still does. */
export function amountTolerance(currencyCode: string | null | undefined): number {
  const code = (currencyCode || "").toUpperCase()
  return ZERO_DECIMAL_CURRENCIES.has(code) ? 0.5 : 0.005
}

export function amountsMatch(a: number, b: number, currencyCode: string | null | undefined): boolean {
  return Math.abs(a - b) <= amountTolerance(currencyCode)
}
