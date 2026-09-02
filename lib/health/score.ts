/** Pure scoring: turns each check's pass/fail population into one 0-100 workspace health score.
 * No Prisma import, no I/O — models/health.ts gathers the inputs and calls this. */

export type CheckScoreInput = {
  checkCode: string
  /** How many items this check evaluated this run (lib/health/types.ts's CheckRunResult.applicableCount).
   * Zero means the check had nothing to say about this workspace — skipped, not scored as 0 or 100. */
  applicableCount: number
  /** How many of those items failed (produced an open finding). Always <= applicableCount. */
  failedCount: number
}

export type HealthScoreConfigInput = {
  checkCode: string
  enabled: boolean
  /** Null means "use the check's own defaultWeight" — HealthScoreConfig.weight is nullable for
   * exactly this reason. */
  weight: number | null
}

export type CheckScoreBreakdownEntry = {
  checkCode: string
  score: number
  weight: number
  applicableCount: number
  failedCount: number
}

export type HealthScoreResult = {
  /** Null when every enabled check was skipped (no applicable items anywhere) — there is nothing
   * to average, not a score of 0. */
  score: number | null
  breakdown: CheckScoreBreakdownEntry[]
  bucket: HealthScoreBucket | null
}

export type HealthScoreBucket = "good" | "warning" | "bad"

/** The score's heart-icon thresholds: 71-100 good, 36-70 warning, 0-35 bad. Exported so the UI and
 * any future alerting read the exact same boundaries this file's tests assert. */
export function scoreBucket(score: number): HealthScoreBucket {
  if (score >= 71) return "good"
  if (score >= 36) return "warning"
  return "bad"
}

/** checkScore = passCount / (passCount + failCount) * 100, i.e. applicableCount treated as
 * (pass + fail). A check with applicableCount 0 is skipped entirely — it must not pull the
 * average toward either 0 or 100 just because it had nothing to check. Enabled/disabled and the
 * weight override come from HealthScoreConfig, falling back to the check's own defaultWeight when
 * no config row exists or its weight is null. Checks with no defaultWeight known to the caller
 * (i.e. not present in `defaultWeights`) are ignored, same as a disabled check. */
export function computeHealthScore(
  inputs: CheckScoreInput[],
  config: HealthScoreConfigInput[],
  defaultWeights: Record<string, number>,
): HealthScoreResult {
  const configByCode = new Map(config.map((c) => [c.checkCode, c]))
  const breakdown: CheckScoreBreakdownEntry[] = []

  for (const input of inputs) {
    if (input.applicableCount <= 0) continue
    const override = configByCode.get(input.checkCode)
    if (override && !override.enabled) continue
    const defaultWeight = defaultWeights[input.checkCode]
    if (defaultWeight === undefined) continue
    const weight = override?.weight ?? defaultWeight

    const score = (input.applicableCount - input.failedCount) / input.applicableCount * 100
    breakdown.push({ checkCode: input.checkCode, score, weight, applicableCount: input.applicableCount, failedCount: input.failedCount })
  }

  const totalWeight = breakdown.reduce((sum, entry) => sum + entry.weight, 0)
  if (totalWeight <= 0) return { score: null, breakdown, bucket: null }

  const score = breakdown.reduce((sum, entry) => sum + entry.score * entry.weight, 0) / totalWeight
  return { score, breakdown, bucket: scoreBucket(score) }
}

// ---- Phase E: predictive score --------------------------------------------------------------

export type ProjectedScoreResult = {
  currentScore: number | null
  projectedScore: number | null
  /** Short human-readable strings naming what would drag the score down if pending documents
   * pushed as-is — e.g. "3 pending documents would create tax mismatches". Empty when the
   * projection finds nothing new to worry about. */
  riskFactors: string[]
  /** Short human-readable strings naming concrete steps to improve the CURRENT score — e.g.
   * "Review 2 documents stuck in low-confidence extraction". Empty when nothing is currently
   * failing. */
  improvementActions: string[]
}

/** Friendlier phrasing for the checks most likely to show up in riskFactors/improvementActions —
 * every other checkCode falls back to its own name with underscores turned to spaces, so a check
 * added later still reads as English without this map growing in lockstep. */
const RISK_LABEL: Record<string, (count: number) => string> = {
  tax_mismatch: (n) => `${n} pending document${n === 1 ? "" : "s"} would create a tax mismatch against the ledger`,
  missing_tax: (n) => `${n} pending document${n === 1 ? "" : "s"} would push with no tax total recorded`,
  ledger_duplicate: (n) => `${n} pending document${n === 1 ? "" : "s"} would look like a duplicate of an existing ledger entry`,
  unreconciled_transactions: (n) => `${n} more ledger transaction${n === 1 ? "" : "s"} would sit unreconciled`,
  uncoded_transactions: (n) => `${n} more ledger transaction${n === 1 ? "" : "s"} would post with no account coding`,
}

const IMPROVEMENT_LABEL: Record<string, (count: number) => string> = {
  uncorrected_low_confidence: (n) => `Review ${n} document${n === 1 ? "" : "s"} stuck in low-confidence extraction`,
  review_backlog: (n) => `Clear ${n} document${n === 1 ? "" : "s"} waiting in the review queue`,
  stale_documents: (n) => `Follow up on ${n} document${n === 1 ? "" : "s"} that have gone stale mid-pipeline`,
  push_failures: (n) => `Retry ${n} accounting push${n === 1 ? "" : "es"} stuck in failure`,
  rule_coverage: (n) => `Add an automation rule to cover ${n} unmatched vendor group${n === 1 ? "" : "s"}`,
  duplicate_contacts: (n) => `Merge ${n} duplicate contact${n === 1 ? "" : "s"} in the ledger`,
  dormant_accounts: (n) => `Review ${n} dormant account${n === 1 ? "" : "s"} still receiving postings`,
  tax_mismatch: (n) => `Resolve ${n} tax mismatch${n === 1 ? "" : "es"} already in the ledger`,
  missing_tax: (n) => `Fill in tax totals for ${n} already-pushed document${n === 1 ? "" : "s"}`,
  vat_number_format: (n) => `Fix ${n} malformed VAT number${n === 1 ? "" : "s"}`,
}

function humanizeCheckCode(checkCode: string): string {
  return checkCode.replace(/_/g, " ")
}

/** Re-runs computeHealthScore's exact weighting math twice — once over the workspace's real,
 * current findings, once over a projection that additionally counts what each not-yet-pushed
 * document would trip if it pushed to the ledger as-is right now (models/health.ts's
 * getProjectedHealthScore builds `projectedInputs` by re-running every check over a CheckContext
 * whose ledger.transactions and documents carry each pending document's own data as a synthetic
 * pushed row — see that file for how the synthetic context is assembled; this function does no
 * CheckContext manipulation itself, only the same scoring arithmetic as computeHealthScore, called
 * twice with a diff on top). Never a parallel scoring reimplementation — both scores come from the
 * same computeHealthScore this file already ships and tests.
 *
 * riskFactors are derived from the DELTA in failedCount between the two runs, restricted to checks
 * with a nonzero weight (a weight-0 check, e.g. any Phase D activity check, can shift in the
 * projection — appending synthetic ledger rows changes reconciliation_rate's population — without
 * that ever being a "risk", since it never touches the score either). improvementActions are
 * derived from the CURRENT run's own failing checks, same nonzero-weight restriction, independent
 * of the projection entirely — these are steps worth taking regardless of what's pending. */
export function projectHealthScore(
  currentInputs: CheckScoreInput[],
  projectedInputs: CheckScoreInput[],
  config: HealthScoreConfigInput[],
  defaultWeights: Record<string, number>,
): ProjectedScoreResult {
  const current = computeHealthScore(currentInputs, config, defaultWeights)
  const projected = computeHealthScore(projectedInputs, config, defaultWeights)

  // Same weight resolution computeHealthScore uses internally (config override, falling back to
  // the check's own defaultWeight; a disabled check or one with no known defaultWeight resolves to
  // undefined). A weight-0 check — every Phase D activity check — must never surface here even
  // though its applicableCount/failedCount can genuinely shift in the projection (appending
  // synthetic ledger rows changes reconciliation_rate's population, for instance): it never moves
  // the score, so it is never a "risk" or an "improvement".
  const configByCode = new Map(config.map((c) => [c.checkCode, c]))
  function scoredWeight(checkCode: string): number | undefined {
    const override = configByCode.get(checkCode)
    if (override && !override.enabled) return undefined
    const defaultWeight = defaultWeights[checkCode]
    if (defaultWeight === undefined) return undefined
    return override?.weight ?? defaultWeight
  }

  const currentFailedByCode = new Map(currentInputs.map((input) => [input.checkCode, input.failedCount]))

  const riskFactors: { impact: number; text: string }[] = []
  for (const input of projectedInputs) {
    const weight = scoredWeight(input.checkCode)
    if (!weight) continue // undefined (disabled/unknown) or exactly 0 — never a score risk
    const before = currentFailedByCode.get(input.checkCode) ?? 0
    const added = input.failedCount - before
    if (added <= 0) continue
    const label = RISK_LABEL[input.checkCode]
    riskFactors.push({ impact: added, text: label ? label(added) : `${added} pending item${added === 1 ? "" : "s"} would trip "${humanizeCheckCode(input.checkCode)}"` })
  }

  const improvementActions: { impact: number; text: string }[] = []
  for (const input of currentInputs) {
    const weight = scoredWeight(input.checkCode)
    if (!weight) continue
    if (input.failedCount <= 0) continue
    const label = IMPROVEMENT_LABEL[input.checkCode]
    improvementActions.push({ impact: input.failedCount, text: label ? label(input.failedCount) : `Review ${input.failedCount} item${input.failedCount === 1 ? "" : "s"} flagged by "${humanizeCheckCode(input.checkCode)}"` })
  }

  const TOP_N = 5
  const byImpactDesc = (a: { impact: number }, b: { impact: number }) => b.impact - a.impact

  return {
    currentScore: current.score,
    projectedScore: projected.score,
    riskFactors: riskFactors.sort(byImpactDesc).slice(0, TOP_N).map((r) => r.text),
    improvementActions: improvementActions.sort(byImpactDesc).slice(0, TOP_N).map((r) => r.text),
  }
}
