import { computePushUpdate, MAX_PUSH_ATTEMPTS, pushOutcome } from "@/lib/integration-push-policy"
import { describe, expect, it } from "vitest"

const now = new Date("2026-08-26T12:00:00Z")

describe("pushOutcome", () => {
  it("succeeds on a successful attempt regardless of attempt count", () => {
    expect(pushOutcome(1, true, now)).toEqual({ status: "succeeded", nextAttemptAt: null })
    expect(pushOutcome(MAX_PUSH_ATTEMPTS, true, now)).toEqual({ status: "succeeded", nextAttemptAt: null })
  })

  it("schedules a backoff retry on failure below the cap", () => {
    const outcome = pushOutcome(1, false, now)
    expect(outcome.status).toBe("pending")
    expect((outcome as { nextAttemptAt: Date }).nextAttemptAt.getTime()).toBeGreaterThan(now.getTime())
  })

  it("gives up once attempts reach MAX_PUSH_ATTEMPTS (5, not webhook's 8)", () => {
    expect(MAX_PUSH_ATTEMPTS).toBe(5)
    expect(pushOutcome(MAX_PUSH_ATTEMPTS, false, now)).toEqual({ status: "failed", nextAttemptAt: null })
    expect(pushOutcome(MAX_PUSH_ATTEMPTS - 1, false, now).status).toBe("pending")
  })
})

describe("computePushUpdate", () => {
  it("increments attempts and marks succeeded with the external id on success", () => {
    const update = computePushUpdate(0, { success: true, errorCode: null, externalBillId: "bill_1" }, now)
    expect(update).toMatchObject({ status: "succeeded", attempts: 1, errorCode: null, externalBillId: "bill_1", leaseUntil: null })
    expect(update.completedAt).toEqual(now)
  })

  it("stays pending with a future nextAttemptAt on a retryable failure", () => {
    const update = computePushUpdate(1, { success: false, errorCode: "http_500", externalBillId: null }, now)
    expect(update.status).toBe("pending")
    expect(update.attempts).toBe(2)
    expect(update.errorCode).toBe("http_500")
    expect(update.completedAt).toBeNull()
    expect(update.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime())
  })

  it("fails terminally once attempts exhaust the cap", () => {
    const update = computePushUpdate(MAX_PUSH_ATTEMPTS - 1, { success: false, errorCode: "http_500", externalBillId: null }, now)
    expect(update.status).toBe("failed")
    expect(update.attempts).toBe(MAX_PUSH_ATTEMPTS)
    expect(update.completedAt).toEqual(now)
  })

  it("forces a terminal failure immediately for a permanent provider error", () => {
    const update = computePushUpdate(0, { success: false, errorCode: "invalid_default_account", externalBillId: null }, now, true)
    expect(update.status).toBe("failed")
    expect(update.attempts).toBe(1)
    expect(update.completedAt).toEqual(now)
  })

  it("clears errorCode on success even if a prior attempt had one", () => {
    const update = computePushUpdate(2, { success: true, errorCode: null, externalBillId: "bill_9" }, now)
    expect(update.errorCode).toBeNull()
  })
})
