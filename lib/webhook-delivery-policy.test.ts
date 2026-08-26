import { describe, expect, it } from "vitest"
import {
  backoffMinutes,
  computeDeliveryUpdate,
  deliveryOutcome,
  endpointFailureUpdate,
  ENDPOINT_DISABLE_THRESHOLD,
  isSuccessStatus,
  MAX_DELIVERY_ATTEMPTS,
} from "./webhook-delivery-policy"

const now = new Date("2026-08-26T12:00:00.000Z")

describe("backoffMinutes", () => {
  it("is exponential then capped at 60", () => {
    expect(backoffMinutes(1)).toBe(2)
    expect(backoffMinutes(2)).toBe(4)
    expect(backoffMinutes(3)).toBe(8)
    expect(backoffMinutes(4)).toBe(16)
    expect(backoffMinutes(5)).toBe(32)
    expect(backoffMinutes(6)).toBe(60) // 64 capped
    expect(backoffMinutes(8)).toBe(60)
  })
})

describe("isSuccessStatus", () => {
  it("is true only for 2xx", () => {
    expect(isSuccessStatus(200)).toBe(true)
    expect(isSuccessStatus(204)).toBe(true)
    expect(isSuccessStatus(299)).toBe(true)
    for (const s of [199, 300, 301, 400, 404, 500]) expect(isSuccessStatus(s)).toBe(false)
  })
})

describe("deliveryOutcome", () => {
  it("delivers on success regardless of attempts", () => {
    expect(deliveryOutcome(1, true, now)).toEqual({ status: "delivered", nextAttemptAt: null })
    expect(deliveryOutcome(8, true, now)).toEqual({ status: "delivered", nextAttemptAt: null })
  })

  it("retries with backoff while attempts remain", () => {
    const out = deliveryOutcome(3, false, now)
    expect(out.status).toBe("pending")
    expect(out.nextAttemptAt).toEqual(new Date(now.getTime() + 8 * 60_000))
  })

  it("gives up at the max attempt count", () => {
    expect(deliveryOutcome(MAX_DELIVERY_ATTEMPTS, false, now)).toEqual({ status: "failed", nextAttemptAt: null })
    expect(deliveryOutcome(MAX_DELIVERY_ATTEMPTS + 1, false, now)).toEqual({ status: "failed", nextAttemptAt: null })
  })

  it("the last retry before the cap is still pending", () => {
    expect(deliveryOutcome(MAX_DELIVERY_ATTEMPTS - 1, false, now).status).toBe("pending")
  })
})

describe("endpointFailureUpdate", () => {
  it("resets to 0 on success", () => {
    expect(endpointFailureUpdate(19, true)).toEqual({ failureCount: 0, disable: false })
  })

  it("increments on failure and disables at the threshold", () => {
    expect(endpointFailureUpdate(0, false)).toEqual({ failureCount: 1, disable: false })
    expect(endpointFailureUpdate(ENDPOINT_DISABLE_THRESHOLD - 2, false)).toEqual({ failureCount: ENDPOINT_DISABLE_THRESHOLD - 1, disable: false })
    expect(endpointFailureUpdate(ENDPOINT_DISABLE_THRESHOLD - 1, false)).toEqual({ failureCount: ENDPOINT_DISABLE_THRESHOLD, disable: true })
  })
})

describe("computeDeliveryUpdate", () => {
  it("marks delivered and resets endpoint on success", () => {
    const u = computeDeliveryUpdate(2, 5, { success: true, responseStatus: 200, errorCode: null }, now)
    expect(u.delivery.status).toBe("delivered")
    expect(u.delivery.attempts).toBe(3)
    expect(u.delivery.deliveredAt).toEqual(now)
    expect(u.delivery.errorCode).toBeNull()
    expect(u.endpoint).toEqual({ failureCount: 0 })
    expect(u.disabled).toBe(false)
  })

  it("schedules a retry with backoff and bumps endpoint failures on a retryable failure", () => {
    const u = computeDeliveryUpdate(2, 5, { success: false, responseStatus: 500, errorCode: "http_500" }, now)
    expect(u.delivery.status).toBe("pending")
    expect(u.delivery.attempts).toBe(3)
    expect(u.delivery.nextAttemptAt).toEqual(new Date(now.getTime() + 8 * 60_000))
    expect(u.delivery.errorCode).toBe("http_500")
    expect(u.delivery.deliveredAt).toBeNull()
    expect(u.endpoint).toEqual({ failureCount: 6 })
  })

  it("fails permanently at the attempt ceiling", () => {
    const u = computeDeliveryUpdate(MAX_DELIVERY_ATTEMPTS - 1, 0, { success: false, responseStatus: null, errorCode: "delivery_request_failed" }, now)
    expect(u.delivery.status).toBe("failed")
    expect(u.delivery.nextAttemptAt).toEqual(now) // terminal → concrete but never re-picked
  })

  it("disables the endpoint at the failure threshold", () => {
    const u = computeDeliveryUpdate(0, ENDPOINT_DISABLE_THRESHOLD - 1, { success: false, responseStatus: 500, errorCode: "http_500" }, now)
    expect(u.disabled).toBe(true)
    expect(u.endpoint).toEqual({ failureCount: ENDPOINT_DISABLE_THRESHOLD, status: "disabled" })
  })
})
