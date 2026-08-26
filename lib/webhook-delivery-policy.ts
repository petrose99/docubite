/** The pure decision layer for webhook delivery: how long to wait before the next attempt, when a
 * delivery has exhausted its retries, and when a persistently-failing endpoint is disabled. Kept
 * separate from lib/webhook-delivery.ts (which does the DB and the HTTP) so every number here is
 * unit-testable without a database or a network. */

/** A delivery is abandoned (status → failed) after this many failed attempts. */
export const MAX_DELIVERY_ATTEMPTS = 8

/** Consecutive endpoint failures after which the endpoint is auto-disabled. Counts failures across
 * deliveries, reset to 0 by any 2xx — so a healthy endpoint never trips it, and a permanently-broken
 * URL stops consuming attempts instead of retrying forever. */
export const ENDPOINT_DISABLE_THRESHOLD = 20

/** How long a claimed delivery is leased to one drain before it may be re-claimed. Short, because a
 * delivery is a ~10s HTTP POST, not the multi-minute document job the DocumentProcessingJob lease
 * (14 min) is sized for. A crashed drain's row becomes claimable again this long after it stopped. */
export const DELIVERY_LEASE_MS = 2 * 60 * 1000

/** Minutes to wait before retry N (1-indexed by attempts-so-far): 2, 4, 8, 16, 32, then capped at
 * 60. Exponential with a ceiling — fast enough to recover from a blip, slow enough not to hammer a
 * struggling receiver. */
export function backoffMinutes(attempts: number): number {
  return Math.min(2 ** Math.max(1, attempts), 60)
}

export function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300
}

export type DeliveryOutcome =
  | { status: "delivered"; nextAttemptAt: null }
  | { status: "failed"; nextAttemptAt: null }
  | { status: "pending"; nextAttemptAt: Date }

/** Given the just-completed attempt (`attempts` = the count AFTER incrementing, `success` = was it
 * 2xx) and `now`, decide the delivery's next state. Pure: the caller supplies `now`.
 *
 * - success            → delivered
 * - failed, attempts<MAX → pending, retry after backoff(attempts)
 * - failed, attempts>=MAX → failed (give up) */
export function deliveryOutcome(attempts: number, success: boolean, now: Date): DeliveryOutcome {
  if (success) return { status: "delivered", nextAttemptAt: null }
  if (attempts >= MAX_DELIVERY_ATTEMPTS) return { status: "failed", nextAttemptAt: null }
  return { status: "pending", nextAttemptAt: new Date(now.getTime() + backoffMinutes(attempts) * 60_000) }
}

/** The endpoint's new failureCount and whether it should now be disabled, given the delivery result.
 * A success resets the counter; a failure increments it and trips the disable at the threshold. */
export function endpointFailureUpdate(currentFailureCount: number, success: boolean): { failureCount: number; disable: boolean } {
  if (success) return { failureCount: 0, disable: false }
  const failureCount = currentFailureCount + 1
  return { failureCount, disable: failureCount >= ENDPOINT_DISABLE_THRESHOLD }
}

export type DeliveryAttemptResult = { success: boolean; responseStatus: number | null; errorCode: string | null }

export type DeliveryUpdate = {
  delivery: {
    status: "delivered" | "failed" | "pending"
    attempts: number
    leaseUntil: null
    nextAttemptAt: Date
    responseStatus: number | null
    errorCode: string | null
    deliveredAt: Date | null
  }
  endpoint: { failureCount: number; status?: "disabled" }
  disabled: boolean
}

/** The full set of DB updates for one completed delivery attempt, computed purely so the orchestrator
 * in lib/webhook-delivery.ts only has to apply them. `priorAttempts` is the delivery's attempts count
 * BEFORE this attempt; `endpointFailureCount` is the endpoint's count before it. `now` is injected.
 *
 * nextAttemptAt is always set to a concrete Date (the backoff time on a retry, or `now` on a terminal
 * outcome — harmless, since a delivered/failed row is never picked again by the drain's status guard). */
export function computeDeliveryUpdate(
  priorAttempts: number,
  endpointFailureCount: number,
  result: DeliveryAttemptResult,
  now: Date
): DeliveryUpdate {
  const attempts = priorAttempts + 1
  const outcome = deliveryOutcome(attempts, result.success, now)
  const failure = endpointFailureUpdate(endpointFailureCount, result.success)
  return {
    delivery: {
      status: outcome.status,
      attempts,
      leaseUntil: null,
      nextAttemptAt: outcome.nextAttemptAt ?? now,
      responseStatus: result.responseStatus,
      errorCode: result.success ? null : result.errorCode,
      deliveredAt: outcome.status === "delivered" ? now : null,
    },
    endpoint: failure.disable ? { failureCount: failure.failureCount, status: "disabled" } : { failureCount: failure.failureCount },
    disabled: failure.disable,
  }
}
