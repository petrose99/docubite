/** The pure decision layer for accounting pushes: how long to wait before the next attempt and
 * when a push has exhausted its retries. A thin wrapper around lib/webhook-delivery-policy.ts's
 * backoffMinutes (same exponential-with-ceiling curve) — kept in its own file, not because the math
 * differs, but because a push's terminal cap is smaller: 5 attempts, not 8. A push targets one
 * external system a human is watching for a specific bill to land, so it gives up sooner and lets
 * the push affordance's "Retry" button take over rather than silently retrying for hours. */

import { backoffMinutes } from "@/lib/webhook-delivery-policy"

/** A push is abandoned (status → failed) after this many failed attempts. */
export const MAX_PUSH_ATTEMPTS = 5

/** How long a claimed push is leased to one drain before it may be re-claimed. Same order of
 * magnitude as DELIVERY_LEASE_MS: a push is one or two provider API calls (find/create vendor,
 * create bill), not a multi-minute job. */
export const PUSH_LEASE_MS = 2 * 60 * 1000

export type PushOutcome =
  | { status: "succeeded"; nextAttemptAt: null }
  | { status: "failed"; nextAttemptAt: null }
  | { status: "pending"; nextAttemptAt: Date }

/** Given the just-completed attempt (`attempts` = the count AFTER incrementing, `success` = did the
 * provider accept the bill) and `now`, decide the push's next state. Pure: the caller supplies `now`.
 *
 * - success                  → succeeded
 * - failed, attempts<MAX     → pending, retry after backoff(attempts)
 * - failed, attempts>=MAX    → failed (give up, surfaced as a Retry button) */
export function pushOutcome(attempts: number, success: boolean, now: Date): PushOutcome {
  if (success) return { status: "succeeded", nextAttemptAt: null }
  if (attempts >= MAX_PUSH_ATTEMPTS) return { status: "failed", nextAttemptAt: null }
  return { status: "pending", nextAttemptAt: new Date(now.getTime() + backoffMinutes(attempts) * 60_000) }
}

export type PushAttemptResult = { success: boolean; errorCode: string | null; externalBillId: string | null }

export type PushUpdate = {
  status: "succeeded" | "failed" | "pending"
  attempts: number
  leaseUntil: null
  nextAttemptAt: Date
  errorCode: string | null
  externalBillId: string | null
  completedAt: Date | null
}

/** The full set of DB updates for one completed push attempt, computed purely so the orchestrator
 * in lib/integration-push.ts only has to apply them. `priorAttempts` is the push's attempts count
 * BEFORE this attempt. `now` is injected.
 *
 * A permanent (non-retryable) failure is signalled by the caller passing `attempts` already at
 * MAX_PUSH_ATTEMPTS regardless of the real prior count — see lib/integration-push.ts, which does
 * this for permanent provider errors so they fail immediately instead of burning retries. */
export function computePushUpdate(priorAttempts: number, result: PushAttemptResult, now: Date, forceTerminal = false): PushUpdate {
  const attempts = priorAttempts + 1
  const effectiveAttempts = forceTerminal ? Math.max(attempts, MAX_PUSH_ATTEMPTS) : attempts
  const outcome = pushOutcome(effectiveAttempts, result.success, now)
  return {
    status: outcome.status,
    attempts,
    leaseUntil: null,
    nextAttemptAt: outcome.nextAttemptAt ?? now,
    errorCode: result.success ? null : result.errorCode,
    externalBillId: result.externalBillId,
    completedAt: outcome.status === "succeeded" || outcome.status === "failed" ? now : null,
  }
}
