import type { CheckResult } from "@/lib/checks/types"

export type StatementPeriod = { periodStart: Date; periodEnd: Date }

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/** Given every bank_statement period for one account, flags a gap between one statement's end
 * and the next one's start — a month nobody uploaded a statement for. Pure over the period list;
 * the caller (models/document-checks.ts) is what actually groups documents by account_number and
 * fetches their periods.
 *
 * Fewer than two periods has nothing to find a gap between, so it returns null rather than a
 * pass — a single statement on file is not evidence of complete coverage, just of one document. */
export function findMissingStatementPeriods(periods: StatementPeriod[]): CheckResult | null {
  if (periods.length < 2) return null

  const sorted = [...periods].sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime())
  const gaps: { from: string; to: string }[] = []
  for (let i = 1; i < sorted.length; i++) {
    const previousEnd = sorted[i - 1].periodEnd
    const nextStart = sorted[i].periodStart
    // More than a day between one statement ending and the next starting is a real gap, not
    // adjacent calendar boundaries (e.g. ends 2026-01-31, next starts 2026-02-01).
    if (nextStart.getTime() - previousEnd.getTime() > ONE_DAY_MS) {
      gaps.push({ from: isoDate(previousEnd), to: isoDate(nextStart) })
    }
  }

  if (!gaps.length) return { checkCode: "missing_statement_period", status: "pass", message: "No gaps between statement periods." }
  return {
    checkCode: "missing_statement_period", status: "warn", detail: { gaps },
    message: `Gap${gaps.length === 1 ? "" : "s"} in statement coverage: ${gaps.map((gap) => `${gap.from} to ${gap.to}`).join(", ")}`,
  }
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}
